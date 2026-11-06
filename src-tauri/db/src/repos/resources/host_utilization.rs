//! Repository for `host_utilization` (migration `e73_host_utilization`): one
//! row per MINUTE of the whole machine - CPU / RAM / GPU shares and the
//! fleet's load - written by the host sampler
//! (`engine::resources::host_sampler`) and read by the standup's resource lane
//! (`host_utilization_series`).
//!
//! The minute (`minute_ms`, epoch ms aligned to a whole minute) is the key, so
//! [`upsert`] is idempotent: a re-flushed minute replaces its row instead of
//! duplicating it. Retention is [`RETENTION_MS`] (14 days); the sampler calls
//! [`prune_before`] once an hour.
//!
//! Absent shares stay `NULL` both ways - "no reading" (GPU off Windows) and
//! "idle" are different facts, and the dead-spot detector must not read a
//! missing GPU as an idle one.

use personas_core::error::AppError;
use personas_core::models::HostUtilizationPoint;
use rusqlite::params;

use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;

/// Every column the row mapper reads, in order. Named rather than `*` so a
/// column added later is a deliberate edit here.
const COLUMNS: &str =
    "minute_ms, cpu_avg, cpu_max, ram_avg, gpu_avg, gpu_max, fleet_running, fleet_queued";

/// One minute in milliseconds.
pub const MINUTE_MS: i64 = 60_000;

/// How long a minute is kept: 14 days.
pub const RETENTION_MS: i64 = 14 * 24 * 60 * MINUTE_MS;

/// The most points one [`series`] call returns: the whole retention window at
/// one point per minute (20,160). A wider range is the caller's to clamp.
pub const MAX_SERIES_POINTS: u32 = (RETENTION_MS / MINUTE_MS) as u32;

row_mapper!(row_to_point -> HostUtilizationPoint {
    minute_ms, cpu_avg, cpu_max, ram_avg, gpu_avg, gpu_max, fleet_running, fleet_queued,
});

/// Write one minute, replacing the row already there for that minute.
pub fn upsert(pool: &DbPool, point: &HostUtilizationPoint) -> Result<(), AppError> {
    timed_query!("host_utilization", "host_utilization::upsert", {
        let conn = pool.conn("host_utilization::upsert")?;
        conn.execute(
            &format!(
                "INSERT INTO host_utilization ({COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(minute_ms) DO UPDATE SET
                    cpu_avg = excluded.cpu_avg,
                    cpu_max = excluded.cpu_max,
                    ram_avg = excluded.ram_avg,
                    gpu_avg = excluded.gpu_avg,
                    gpu_max = excluded.gpu_max,
                    fleet_running = excluded.fleet_running,
                    fleet_queued = excluded.fleet_queued"
            ),
            params![
                point.minute_ms,
                point.cpu_avg,
                point.cpu_max,
                point.ram_avg,
                point.gpu_avg,
                point.gpu_max,
                point.fleet_running,
                point.fleet_queued,
            ],
        )?;
        Ok(())
    })
}

/// The minutes with `since_ms <= minute_ms < until_ms`, oldest first, at most
/// [`MAX_SERIES_POINTS`]. An empty or inverted range reads as no rows.
pub fn series(
    pool: &DbPool,
    since_ms: i64,
    until_ms: i64,
) -> Result<Vec<HostUtilizationPoint>, AppError> {
    if until_ms <= since_ms {
        return Ok(Vec::new());
    }
    timed_query!("host_utilization", "host_utilization::series", {
        let conn = pool.conn("host_utilization::series")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM host_utilization
             WHERE minute_ms >= ?1 AND minute_ms < ?2
             ORDER BY minute_ms ASC
             LIMIT ?3"
        ))?;
        let rows = stmt.query_map(
            params![since_ms, until_ms, i64::from(MAX_SERIES_POINTS)],
            row_to_point,
        )?;
        Ok(collect_rows(rows, "host_utilization::series"))
    })
}

/// Drop every minute older than `cutoff_ms`. Returns how many rows went.
pub fn prune_before(pool: &DbPool, cutoff_ms: i64) -> Result<usize, AppError> {
    timed_query!("host_utilization", "host_utilization::prune_before", {
        let conn = pool.conn("host_utilization::prune_before")?;
        let n = conn.execute(
            "DELETE FROM host_utilization WHERE minute_ms < ?1",
            params![cutoff_ms],
        )?;
        Ok(n)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn point(minute: i64, cpu: Option<f64>, gpu: Option<f64>) -> HostUtilizationPoint {
        HostUtilizationPoint {
            minute_ms: minute * MINUTE_MS,
            cpu_avg: cpu.map(|c| c / 2.0),
            cpu_max: cpu,
            ram_avg: Some(0.5),
            gpu_avg: gpu.map(|g| g / 2.0),
            gpu_max: gpu,
            fleet_running: 1,
            fleet_queued: 2,
        }
    }

    #[test]
    fn upsert_replaces_the_minute_and_keeps_null_shares_null() {
        let pool = init_test_db().unwrap();
        upsert(&pool, &point(10, Some(0.4), None)).unwrap();
        upsert(&pool, &point(10, Some(0.8), None)).unwrap();
        let rows = series(&pool, 0, 100 * MINUTE_MS).unwrap();
        assert_eq!(rows.len(), 1, "one row per minute");
        assert_eq!(rows[0].cpu_max, Some(0.8), "the re-flush replaced it");
        assert_eq!(rows[0].gpu_max, None, "no reading stays NULL, never 0");
        assert_eq!(rows[0].gpu_avg, None);
        assert_eq!(rows[0], point(10, Some(0.8), None), "round-trips whole");
    }

    #[test]
    fn series_is_half_open_and_ascending() {
        let pool = init_test_db().unwrap();
        for m in [5, 3, 4, 7, 6] {
            upsert(&pool, &point(m, Some(0.1), Some(0.2))).unwrap();
        }
        let rows = series(&pool, 4 * MINUTE_MS, 7 * MINUTE_MS).unwrap();
        let minutes: Vec<i64> = rows.iter().map(|p| p.minute_ms / MINUTE_MS).collect();
        assert_eq!(minutes, vec![4, 5, 6], "since inclusive, until exclusive");
        assert!(series(&pool, 7 * MINUTE_MS, 4 * MINUTE_MS)
            .unwrap()
            .is_empty());
        assert!(series(&pool, 5 * MINUTE_MS, 5 * MINUTE_MS)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn prune_drops_only_older_minutes() {
        let pool = init_test_db().unwrap();
        for m in 1..=5 {
            upsert(&pool, &point(m, Some(0.1), None)).unwrap();
        }
        assert_eq!(prune_before(&pool, 3 * MINUTE_MS).unwrap(), 2);
        let left: Vec<i64> = series(&pool, 0, i64::MAX)
            .unwrap()
            .iter()
            .map(|p| p.minute_ms / MINUTE_MS)
            .collect();
        assert_eq!(left, vec![3, 4, 5]);
        assert_eq!(prune_before(&pool, 3 * MINUTE_MS).unwrap(), 0);
    }

    #[test]
    fn the_series_cap_is_the_retention_window() {
        assert_eq!(MAX_SERIES_POINTS, 20_160);
    }
}
