//! Repository for `mesh_probe_results` (migration `e66_device_mesh`): one row
//! per onboarding/probe test verdict recorded against a paired device.
//!
//! Append-only. The device strip reads the newest verdict per peer
//! ([`latest_for_peer`]); `mesh_probe_results(peerId)` lists them newest first
//! ([`list_for_peer`]). A skipped test is `passed: false, skipped: true`
//! (contract amendment A2), so no reader shows a skip as a failure.

use personas_core::error::AppError;
use personas_core::models::MeshProbeVerdict;
use rusqlite::params;

use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;

/// Every column [`row_to_verdict_raw`] reads. Named rather than `*` so a
/// column added later is a deliberate edit here.
const COLUMNS: &str = "peer_id, test_id, passed, skipped, detail, at_ms";

/// Newest-first page size when the caller names none, and the hard cap.
pub const DEFAULT_LIST_LIMIT: u32 = 50;
pub const MAX_LIST_LIMIT: u32 = 500;

/// The row as SQLite hands it over: the instant still an integer.
struct VerdictRow {
    peer_id: String,
    test_id: String,
    passed: bool,
    skipped: bool,
    detail: Option<String>,
    at_ms: i64,
}

row_mapper!(row_to_verdict_raw -> VerdictRow {
    peer_id, test_id, passed [bool], skipped [bool], detail, at_ms,
});

fn row_to_verdict(row: &rusqlite::Row) -> rusqlite::Result<MeshProbeVerdict> {
    let raw = row_to_verdict_raw(row)?;
    Ok(MeshProbeVerdict {
        peer_id: raw.peer_id,
        test_id: raw.test_id,
        passed: raw.passed,
        skipped: raw.skipped,
        detail: raw.detail,
        at_ms: raw.at_ms as f64,
    })
}

/// Record one verdict. A skip is stored as not passed, whatever the caller
/// sent in `passed`, so a "skipped and passed" row cannot exist.
pub fn insert(pool: &DbPool, verdict: &MeshProbeVerdict) -> Result<(), AppError> {
    personas_core::validation::require_non_empty("peerId", &verdict.peer_id)?;
    personas_core::validation::require_non_empty("testId", &verdict.test_id)?;
    timed_query!("mesh_probe_results", "mesh_probes::insert", {
        let conn = pool.conn("mesh_probes::insert")?;
        conn.execute(
            &format!(
                "INSERT INTO mesh_probe_results (id, {COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
            ),
            params![
                uuid::Uuid::new_v4().to_string(),
                verdict.peer_id,
                verdict.test_id,
                i64::from(verdict.passed && !verdict.skipped),
                i64::from(verdict.skipped),
                verdict.detail,
                verdict.at_ms.round() as i64,
            ],
        )?;
        Ok(())
    })
}

/// One peer's verdicts, newest first. `limit` defaults to
/// [`DEFAULT_LIST_LIMIT`] and is capped at [`MAX_LIST_LIMIT`].
pub fn list_for_peer(
    pool: &DbPool,
    peer_id: &str,
    limit: Option<u32>,
) -> Result<Vec<MeshProbeVerdict>, AppError> {
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    timed_query!("mesh_probe_results", "mesh_probes::list_for_peer", {
        let conn = pool.conn("mesh_probes::list_for_peer")?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM mesh_probe_results
             WHERE peer_id = ?1
             ORDER BY at_ms DESC, rowid DESC
             LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![peer_id, i64::from(limit)], row_to_verdict)?;
        Ok(collect_rows(rows, "mesh_probes::list_for_peer"))
    })
}

/// The newest verdict for one peer, or `None` when it was never probed.
pub fn latest_for_peer(pool: &DbPool, peer_id: &str) -> Result<Option<MeshProbeVerdict>, AppError> {
    Ok(list_for_peer(pool, peer_id, Some(1))?.into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn verdict(
        peer: &str,
        test: &str,
        passed: bool,
        skipped: bool,
        at_ms: f64,
    ) -> MeshProbeVerdict {
        MeshProbeVerdict {
            peer_id: peer.into(),
            test_id: test.into(),
            passed,
            skipped,
            detail: Some(format!("{test} detail")),
            at_ms,
        }
    }

    #[test]
    fn verdicts_list_newest_first_and_the_latest_is_per_peer() {
        let pool = init_test_db().unwrap();
        insert(&pool, &verdict("a", "t1_ping", true, false, 1_000.0)).unwrap();
        insert(&pool, &verdict("a", "t2_snapshot", false, false, 2_000.0)).unwrap();
        insert(&pool, &verdict("b", "t1_ping", true, false, 3_000.0)).unwrap();

        let a = list_for_peer(&pool, "a", None).unwrap();
        assert_eq!(
            a.iter().map(|v| v.test_id.as_str()).collect::<Vec<_>>(),
            vec!["t2_snapshot", "t1_ping"]
        );
        assert_eq!(
            latest_for_peer(&pool, "a").unwrap().unwrap().test_id,
            "t2_snapshot"
        );
        assert_eq!(latest_for_peer(&pool, "b").unwrap().unwrap().at_ms, 3_000.0);
        assert_eq!(latest_for_peer(&pool, "never").unwrap(), None);
        assert_eq!(list_for_peer(&pool, "a", Some(1)).unwrap().len(), 1);
    }

    #[test]
    fn a_skip_is_stored_as_not_passed_and_round_trips() {
        let pool = init_test_db().unwrap();
        insert(&pool, &verdict("a", "t5_push", true, true, 1.0)).unwrap();
        let v = latest_for_peer(&pool, "a").unwrap().unwrap();
        assert!(v.skipped);
        assert!(!v.passed, "a skip is never a pass");
        assert_eq!(v.detail.as_deref(), Some("t5_push detail"));
    }

    #[test]
    fn an_empty_peer_or_test_id_is_refused() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            insert(&pool, &verdict("", "t1", true, false, 1.0)),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            insert(&pool, &verdict("a", " ", true, false, 1.0)),
            Err(AppError::Validation(_))
        ));
    }
}
