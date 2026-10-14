//! Repository for `run_resource_summaries` (migration `e66_device_mesh`): one
//! row per FINISHED run - a fleet session or a persona execution - saying what
//! it actually consumed of this machine as shares of its capacity.
//!
//! Append-only. [`insert`] is idempotent on `(run_kind, run_id)` (`ON CONFLICT
//! DO NOTHING`), so a repeated end hook cannot double-count a run, and it
//! reports whether the row was genuinely new so the caller runs the profile
//! loop exactly once per run.
//!
//! The per-charter aggregate the profile loop and `responsibility_measured`
//! both read is computed HERE, once ([`measure_for_responsibility`],
//! [`measure_for_persona`]): a count of the charter's summaries plus the
//! MEDIAN of the per-run values over its newest
//! [`MEASURED_PROFILE_WINDOW`] runs. The median is taken in Rust - SQLite has
//! no median aggregate - over at most that many rows per charter.

use std::collections::HashMap;

use personas_core::error::AppError;
use personas_core::models::{
    GpuClass, MachineLoad, ResourceAxis, RunKind, RunResourceSummary, MEASURED_PROFILE_MIN_RUNS,
    MEASURED_PROFILE_WINDOW,
};
use rusqlite::params;

use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;

/// Every column [`row_to_summary_raw`] reads, in order. Named rather than `*`
/// so a column added later is a deliberate edit here.
const COLUMNS: &str = "run_kind, run_id, persona_id, responsibility_id, cpu_p95_share, \
     ram_peak_share, gpu_p95_share, dominant, samples, started_at_ms, ended_at_ms";

/// Newest-first page size when the caller names none, and the hard cap.
pub const DEFAULT_LIST_LIMIT: u32 = 50;
pub const MAX_LIST_LIMIT: u32 = 500;

/// The row exactly as SQLite hands it over: the two enums still text and the
/// instants still integers. [`row_to_summary`] narrows it.
struct SummaryRow {
    run_kind: String,
    run_id: String,
    persona_id: Option<String>,
    responsibility_id: Option<String>,
    cpu_p95_share: f64,
    ram_peak_share: f64,
    gpu_p95_share: Option<f64>,
    dominant: String,
    samples: i64,
    started_at_ms: i64,
    ended_at_ms: i64,
}

row_mapper!(row_to_summary_raw -> SummaryRow {
    run_kind, run_id, persona_id, responsibility_id, cpu_p95_share,
    ram_peak_share, gpu_p95_share, dominant, samples, started_at_ms, ended_at_ms,
});

fn bad_token(column: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown run_resource_summaries.{column} `{value}`"),
        )),
    )
}

fn row_to_summary(row: &rusqlite::Row) -> rusqlite::Result<RunResourceSummary> {
    let raw = row_to_summary_raw(row)?;
    // Both columns carry a CHECK, so an unknown token is only reachable past
    // it; surface it as a mapping error rather than a guessed default.
    let run_kind =
        RunKind::parse(&raw.run_kind).ok_or_else(|| bad_token("run_kind", &raw.run_kind))?;
    let dominant =
        ResourceAxis::parse(&raw.dominant).ok_or_else(|| bad_token("dominant", &raw.dominant))?;
    Ok(RunResourceSummary {
        run_kind,
        run_id: raw.run_id,
        persona_id: raw.persona_id,
        responsibility_id: raw.responsibility_id,
        cpu_p95_share: raw.cpu_p95_share,
        ram_peak_share: raw.ram_peak_share,
        gpu_p95_share: raw.gpu_p95_share,
        dominant,
        samples: u32::try_from(raw.samples).unwrap_or(0),
        started_at_ms: raw.started_at_ms as f64,
        ended_at_ms: raw.ended_at_ms as f64,
    })
}

/// Record one finished run. Returns `true` when the row is new, `false` when
/// `(run_kind, run_id)` was already summarised (nothing is written).
pub fn insert(pool: &DbPool, summary: &RunResourceSummary) -> Result<bool, AppError> {
    timed_query!("run_resource_summaries", "run_resources::insert", {
        let conn = pool.conn("run_resources::insert")?;
        let inserted = conn.execute(
            &format!(
                "INSERT INTO run_resource_summaries (id, {COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(run_kind, run_id) DO NOTHING"
            ),
            params![
                uuid::Uuid::new_v4().to_string(),
                summary.run_kind.as_str(),
                summary.run_id,
                summary.persona_id,
                summary.responsibility_id,
                summary.cpu_p95_share,
                summary.ram_peak_share,
                summary.gpu_p95_share,
                summary.dominant.as_str(),
                i64::from(summary.samples),
                summary.started_at_ms.round() as i64,
                summary.ended_at_ms.round() as i64,
            ],
        )?;
        Ok(inserted > 0)
    })
}

/// A persona's finished-run summaries, newest first. `limit` defaults to
/// [`DEFAULT_LIST_LIMIT`] and is capped at [`MAX_LIST_LIMIT`].
pub fn list_for_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<u32>,
) -> Result<Vec<RunResourceSummary>, AppError> {
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    timed_query!(
        "run_resource_summaries",
        "run_resources::list_for_persona",
        {
            let conn = pool.conn("run_resources::list_for_persona")?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM run_resource_summaries
             WHERE persona_id = ?1
             ORDER BY ended_at_ms DESC, rowid DESC
             LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![persona_id, i64::from(limit)], row_to_summary)?;
            Ok(collect_rows(rows, "run_resources::list_for_persona"))
        }
    )
}

/// What a charter's runs measured: the count of ALL its summaries, and the
/// medians of the per-run values over its newest [`MEASURED_PROFILE_WINDOW`].
#[derive(Debug, Clone, PartialEq)]
pub struct ResourceMeasure {
    pub runs: u32,
    pub cpu_p95_share: f64,
    pub ram_peak_share: f64,
    /// Median over the windowed runs that HAD a GPU reading; `None` when none
    /// did.
    pub gpu_p95_share: Option<f64>,
    pub dominant: ResourceAxis,
}

impl ResourceMeasure {
    /// The profile tags this measurement maps to, or `None` while the charter
    /// has fewer than [`MEASURED_PROFILE_MIN_RUNS`] runs (the measurement is
    /// shown, but too thin to tag). The GPU half is `None` when no run had a
    /// GPU reading. The ONE call site of the mapping for both the profile loop
    /// and `responsibility_measured`, so the two can never disagree.
    pub fn tags(&self) -> Option<(MachineLoad, Option<GpuClass>)> {
        (self.runs >= MEASURED_PROFILE_MIN_RUNS).then(|| {
            (
                MachineLoad::from_measured(self.cpu_p95_share, self.ram_peak_share),
                GpuClass::from_measured_share(self.gpu_p95_share),
            )
        })
    }
}

/// The median of `values` (the mean of the middle two for an even count);
/// `None` for an empty slice. NaN sorts as equal, so it cannot panic.
pub fn median(values: &mut [f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = values.len() / 2;
    Some(if values.len() % 2 == 0 {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    })
}

/// One windowed row of the per-charter aggregate, as SQL hands it over.
struct WindowRow {
    responsibility_id: String,
    cpu_p95_share: f64,
    ram_peak_share: f64,
    gpu_p95_share: Option<f64>,
    runs: i64,
}

row_mapper!(row_to_window -> WindowRow {
    responsibility_id, cpu_p95_share, ram_peak_share, gpu_p95_share, runs,
});

/// Fold windowed rows into one [`ResourceMeasure`] per charter.
fn fold_windows(rows: Vec<WindowRow>) -> HashMap<String, ResourceMeasure> {
    #[derive(Default)]
    struct Acc {
        runs: i64,
        cpu: Vec<f64>,
        ram: Vec<f64>,
        gpu: Vec<f64>,
    }
    let mut by_charter: HashMap<String, Acc> = HashMap::new();
    for row in rows {
        let acc = by_charter.entry(row.responsibility_id).or_default();
        acc.runs = row.runs;
        acc.cpu.push(row.cpu_p95_share);
        acc.ram.push(row.ram_peak_share);
        if let Some(g) = row.gpu_p95_share {
            acc.gpu.push(g);
        }
    }
    by_charter
        .into_iter()
        .filter_map(|(id, mut acc)| {
            let cpu = median(&mut acc.cpu)?;
            let ram = median(&mut acc.ram)?;
            let gpu = median(&mut acc.gpu);
            Some((
                id,
                ResourceMeasure {
                    runs: u32::try_from(acc.runs).unwrap_or(u32::MAX),
                    cpu_p95_share: cpu,
                    ram_peak_share: ram,
                    gpu_p95_share: gpu,
                    dominant: ResourceAxis::dominant(cpu, ram, gpu),
                },
            ))
        })
        .collect()
}

/// The windowed projection both readers share; `{filter}` narrows the charters.
fn windowed_sql(filter: &str) -> String {
    format!(
        "WITH ranked AS (
             SELECT responsibility_id, cpu_p95_share, ram_peak_share, gpu_p95_share,
                    ROW_NUMBER() OVER (
                        PARTITION BY responsibility_id
                        ORDER BY ended_at_ms DESC, rowid DESC
                    ) AS rn,
                    COUNT(*) OVER (PARTITION BY responsibility_id) AS runs
             FROM run_resource_summaries
             WHERE responsibility_id IS NOT NULL AND {filter}
         )
         SELECT responsibility_id, cpu_p95_share, ram_peak_share, gpu_p95_share, runs
         FROM ranked WHERE rn <= ?2"
    )
}

/// One charter's measurement, or `None` when it has no summarised run.
pub fn measure_for_responsibility(
    pool: &DbPool,
    responsibility_id: &str,
) -> Result<Option<ResourceMeasure>, AppError> {
    timed_query!(
        "run_resource_summaries",
        "run_resources::measure_for_responsibility",
        {
            let conn = pool.conn("run_resources::measure_for_responsibility")?;
            let mut stmt = conn.prepare(&windowed_sql("responsibility_id = ?1"))?;
            let rows = stmt.query_map(
                params![responsibility_id, i64::from(MEASURED_PROFILE_WINDOW)],
                row_to_window,
            )?;
            let mut out = fold_windows(collect_rows(
                rows,
                "run_resources::measure_for_responsibility",
            ));
            Ok(out.remove(responsibility_id))
        }
    )
}

/// The measurement of every charter a persona OWNS (by
/// `persona_responsibilities.persona_id`, not by the summary's own
/// `persona_id`, so a fleet run whose persona could not be resolved still
/// counts toward its charter), keyed by charter id. Charters with no
/// summarised run are absent.
pub fn measure_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<HashMap<String, ResourceMeasure>, AppError> {
    timed_query!(
        "run_resource_summaries",
        "run_resources::measure_for_persona",
        {
            let conn = pool.conn("run_resources::measure_for_persona")?;
            let mut stmt = conn.prepare(&windowed_sql(
                "responsibility_id IN (
                 SELECT id FROM persona_responsibilities WHERE persona_id = ?1)",
            ))?;
            let rows = stmt.query_map(
                params![persona_id, i64::from(MEASURED_PROFILE_WINDOW)],
                row_to_window,
            )?;
            Ok(fold_windows(collect_rows(
                rows,
                "run_resources::measure_for_persona",
            )))
        }
    )
}

/// The dominant axis of each persona's NEWEST summarised run, keyed by
/// persona id (the device mesh's `DeviceAgent.dominant`). Personas with no
/// summarised run are absent. One query for the whole roster.
pub fn latest_dominant_by_persona(
    pool: &DbPool,
) -> Result<HashMap<String, ResourceAxis>, AppError> {
    timed_query!(
        "run_resource_summaries",
        "run_resources::latest_dominant_by_persona",
        {
            let conn = pool.conn("run_resources::latest_dominant_by_persona")?;
            let mut stmt = conn.prepare(
                "WITH ranked AS (
                     SELECT persona_id, dominant,
                            ROW_NUMBER() OVER (
                                PARTITION BY persona_id
                                ORDER BY ended_at_ms DESC, rowid DESC
                            ) AS rn
                     FROM run_resource_summaries
                     WHERE persona_id IS NOT NULL
                 )
                 SELECT persona_id, dominant FROM ranked WHERE rn = 1",
            )?;
            let rows = stmt.query_map([], |row| {
                let persona_id: String = row.get("persona_id")?;
                let dominant: String = row.get("dominant")?;
                let axis = ResourceAxis::parse(&dominant)
                    .ok_or_else(|| bad_token("dominant", &dominant))?;
                Ok((persona_id, axis))
            })?;
            Ok(
                collect_rows(rows, "run_resources::latest_dominant_by_persona")
                    .into_iter()
                    .collect(),
            )
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    #[test]
    fn latest_dominant_is_the_newest_run_per_persona() {
        let pool = init_test_db().unwrap();
        // p1: an old cpu-heavy run, then a newer ram-heavy one.
        insert(&pool, &summary("e1", Some("p1"), None, 0.9, 0.1, None, 1.0)).unwrap();
        insert(&pool, &summary("e2", Some("p1"), None, 0.1, 0.8, None, 2.0)).unwrap();
        insert(
            &pool,
            &summary("e3", Some("p2"), None, 0.1, 0.1, Some(0.7), 1.0),
        )
        .unwrap();
        insert(&pool, &summary("e4", None, None, 0.9, 0.1, None, 9.0)).unwrap();
        let latest = latest_dominant_by_persona(&pool).unwrap();
        assert_eq!(latest.len(), 2, "a run with no persona is not anyone's");
        assert_eq!(latest.get("p1"), Some(&ResourceAxis::Ram));
        assert_eq!(latest.get("p2"), Some(&ResourceAxis::Gpu));
    }

    fn summary(
        run_id: &str,
        persona: Option<&str>,
        charter: Option<&str>,
        cpu: f64,
        ram: f64,
        gpu: Option<f64>,
        ended_at_ms: f64,
    ) -> RunResourceSummary {
        RunResourceSummary {
            run_kind: RunKind::Execution,
            run_id: run_id.into(),
            persona_id: persona.map(str::to_string),
            responsibility_id: charter.map(str::to_string),
            cpu_p95_share: cpu,
            ram_peak_share: ram,
            gpu_p95_share: gpu,
            dominant: ResourceAxis::dominant(cpu, ram, gpu),
            samples: 3,
            started_at_ms: ended_at_ms - 15_000.0,
            ended_at_ms,
        }
    }

    fn insert_persona_and_charter(pool: &DbPool, persona: &str, charter: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
            params![persona],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO persona_responsibilities (id, persona_id, title, created_at, updated_at)
             VALUES (?1, ?2, 'charter', datetime('now'), datetime('now'))",
            params![charter, persona],
        )
        .unwrap();
    }

    #[test]
    fn insert_is_once_per_run_and_lists_newest_first() {
        let pool = init_test_db().unwrap();
        let a = summary("e1", Some("p1"), None, 0.2, 0.1, None, 1_000.0);
        assert!(insert(&pool, &a).unwrap());
        // A repeated end hook writes nothing.
        assert!(!insert(&pool, &a).unwrap());
        let b = summary("e2", Some("p1"), None, 0.1, 0.3, Some(0.4), 2_000.0);
        assert!(insert(&pool, &b).unwrap());
        insert(
            &pool,
            &summary("e3", Some("p2"), None, 0.1, 0.1, None, 3_000.0),
        )
        .unwrap();

        let rows = list_for_persona(&pool, "p1", None).unwrap();
        assert_eq!(rows, vec![b.clone(), a]);
        assert_eq!(rows[0].gpu_p95_share, Some(0.4));
        assert_eq!(list_for_persona(&pool, "p1", Some(1)).unwrap(), vec![b]);
        // Limit 0 still returns a page (clamped up), never an empty read.
        assert_eq!(list_for_persona(&pool, "p1", Some(0)).unwrap().len(), 1);
    }

    #[test]
    fn a_none_gpu_round_trips_as_none_never_zero() {
        let pool = init_test_db().unwrap();
        insert(&pool, &summary("e1", Some("p1"), None, 0.2, 0.1, None, 1.0)).unwrap();
        let rows = list_for_persona(&pool, "p1", None).unwrap();
        assert_eq!(rows[0].gpu_p95_share, None);
    }

    #[test]
    fn median_handles_odd_even_and_empty() {
        assert_eq!(median(&mut []), None);
        assert_eq!(median(&mut [3.0, 1.0, 2.0]), Some(2.0));
        assert_eq!(median(&mut [4.0, 1.0, 3.0, 2.0]), Some(2.5));
    }

    #[test]
    fn measure_counts_all_runs_and_medians_the_newest_window() {
        let pool = init_test_db().unwrap();
        insert_persona_and_charter(&pool, "p1", "c1");
        // 25 runs: the 5 OLDEST are huge, the newest 20 are 0.1 cpu / 0.3 ram.
        for i in 0..25 {
            let (cpu, ram) = if i < 5 { (0.9, 0.9) } else { (0.1, 0.3) };
            let gpu = (i % 2 == 0).then_some(0.6);
            let s = summary(
                &format!("e{i}"),
                Some("p1"),
                Some("c1"),
                cpu,
                ram,
                gpu,
                f64::from(i),
            );
            insert(&pool, &s).unwrap();
        }
        let m = measure_for_responsibility(&pool, "c1").unwrap().unwrap();
        assert_eq!(m.runs, 25);
        assert_eq!(
            m.cpu_p95_share, 0.1,
            "the old outliers are outside the window"
        );
        assert_eq!(m.ram_peak_share, 0.3);
        assert_eq!(
            m.gpu_p95_share,
            Some(0.6),
            "the median is over runs WITH a reading"
        );
        assert_eq!(m.dominant, ResourceAxis::Gpu);
        assert_eq!(
            m.tags(),
            Some((MachineLoad::Heavy, Some(GpuClass::Exclusive)))
        );

        let by_persona = measure_for_persona(&pool, "p1").unwrap();
        assert_eq!(by_persona.get("c1"), Some(&m));
        assert!(measure_for_persona(&pool, "nobody").unwrap().is_empty());
        assert_eq!(measure_for_responsibility(&pool, "c-none").unwrap(), None);
    }

    #[test]
    fn tags_wait_for_the_minimum_runs_and_keep_an_unread_gpu_unread() {
        let pool = init_test_db().unwrap();
        insert_persona_and_charter(&pool, "p1", "c1");
        for i in 0..(MEASURED_PROFILE_MIN_RUNS - 1) {
            let s = summary(
                &format!("e{i}"),
                Some("p1"),
                Some("c1"),
                0.6,
                0.0,
                None,
                f64::from(i),
            );
            insert(&pool, &s).unwrap();
        }
        let thin = measure_for_responsibility(&pool, "c1").unwrap().unwrap();
        assert_eq!(thin.runs, MEASURED_PROFILE_MIN_RUNS - 1);
        assert_eq!(thin.tags(), None);
        assert_eq!(thin.gpu_p95_share, None);

        let s = summary("last", Some("p1"), Some("c1"), 0.6, 0.0, None, 99.0);
        insert(&pool, &s).unwrap();
        let enough = measure_for_responsibility(&pool, "c1").unwrap().unwrap();
        assert_eq!(enough.tags(), Some((MachineLoad::Exclusive, None)));
    }
}
