//! Sleep-cycle journal + audit spine.
//!
//! A **cycle** is one scheduled reconciliation pass over Athena's memory —
//! compress, reconcile, identity, critique (phase L1 of
//! `docs/plans/athena-longevity.md`). This module is the substrate that pass
//! writes into, shipped ahead of the cycle logic itself so the L1 wave can
//! stay focused on judgement rather than plumbing.
//!
//! It deliberately contains **no scheduler and no night-shift wiring**. It is
//! storage plus retrieval: begin a cycle, record each phase as it completes,
//! finish with stats and a narrative report, list and read what happened.
//!
//! ## Two things get written, for two different readers
//!
//! 1. **`companion_cycle`** — the structured row. Machine-readable status,
//!    phase log and stats; what a dashboard filters and sorts.
//! 2. **A `companion_node` of `kind='cycle_report'`** — the narrative. Markdown
//!    on disk under `cycles/<date>-<id>.md` (source of truth, mirroring
//!    `episodic::append_episode`), a `body_excerpt` row in the node index, and
//!    a **`companion_fts` mirror row**.
//!
//! That FTS mirror is a **contract, not an optimization**. `brain::keyword`
//! reads `companion_fts` with BM25 and it is the *only* retrieval lane on the
//! non-`ml` build the app actually ships — the vector lane is `ml`-gated and
//! never compiles. A new node kind that skips the mirror is invisible to
//! recall: it would sit in the database, look perfectly stored, and never come
//! back from a search. (See the restored-writer comments in `episodic.rs`,
//! 2026-08-08, for how close that table came to being deleted.)
//!
//! ## Honest status
//!
//! A cycle that never reaches [`finish_cycle`] stays `running` forever. There
//! is no sweeper that rewrites it, because "the process died" and "the cycle
//! is still working" are genuinely different facts and this ledger must not
//! guess between them. A cycle that failed is finished *as* `failed`, with the
//! reason inside `stats_json.error` — a failure is a completed observation,
//! not an absence of one.

// Substrate shipped ahead of its caller. `list_recent` has one (the
// `companion_list_cycle_reports` command); `begin_cycle` / `record_phase` /
// `finish_cycle` / `get` and the status constants are called by the L1 sleep
// cycle, which is the next wave. The alternative — withholding the module
// until L1 — is what made L1 a two-job wave in the first place. This allow is
// scoped to this file and comes off the moment the cycle lands; if it is still
// here after L1, the cycle is not using its own audit spine.
#![allow(dead_code)]

use std::fs;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use ts_rs::TS;

use crate::companion::brain::util;
use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

/// `companion_node.kind` for a cycle's narrative report. Public because
/// retrieval callers pass it to `keyword::search_kind` and a second string
/// literal is exactly how a lane goes quietly dark.
pub const CYCLE_REPORT_KIND: &str = "cycle_report";

/// Status of a cycle that is still running.
pub const STATUS_RUNNING: &str = "running";
/// Status of a cycle that finished its phases.
pub const STATUS_COMPLETED: &str = "completed";
/// Status of a cycle that finished by failing.
pub const STATUS_FAILED: &str = "failed";

/// Cap on the report body mirrored into FTS and excerpted into the node row.
/// A cycle report is prose written for a human; 200KB of it would mean the
/// cycle went wrong, and letting an unbounded body into the index is how the
/// prompt-side blocks grew unnoticed in the first place.
const MAX_REPORT_CHARS: usize = 64_000;

/// One phase's outcome inside a cycle.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CyclePhase {
    /// `compress` | `reconcile` | `identity` | `critique` | … — free-form, so
    /// L1 can add a phase without a schema change.
    pub phase: String,
    /// `completed` | `failed` | `skipped`.
    pub status: String,
    /// One line of human-readable detail, or empty.
    pub detail: String,
    /// RFC3339 timestamp of when the phase was recorded.
    pub at: String,
}

/// A cycle as the UI reads it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CycleSummary {
    pub id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    /// `running` | `completed` | `failed`.
    pub status: String,
    pub phases: Vec<CyclePhase>,
    /// Raw JSON object of whatever the cycle counted, so a new stat needs no
    /// binding change (same contract as `companion_turn.outcome_json`).
    pub stats_json: String,
    /// The `companion_node` id of the narrative report, once one exists.
    pub report_node_id: Option<String>,
}

/// Open a cycle and return its id. Status starts — and stays — `running`
/// until [`finish_cycle`].
pub fn begin_cycle(pool: &UserDbPool) -> Result<String, AppError> {
    let id = format!("cyc_{}", util::short_id(12));
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_cycle (id, started_at, status, phases_json, stats_json)
         VALUES (?1, ?2, ?3, '[]', '{}')",
        params![id, now, STATUS_RUNNING],
    )?;
    Ok(id)
}

/// Append one phase outcome to a cycle's audit trail.
///
/// Read-modify-write of `phases_json` rather than a child table: a cycle has a
/// handful of phases, they are only ever read as a whole, and the alternative
/// is a second table that every consumer must join. Unknown cycle id is an
/// error rather than a silent no-op — a phase recorded against nothing means
/// the caller lost track of its own cycle.
pub fn record_phase(
    pool: &UserDbPool,
    cycle_id: &str,
    phase: &str,
    status: &str,
    detail: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT phases_json FROM companion_cycle WHERE id = ?1",
            params![cycle_id],
            |r| r.get(0),
        )
        .optional()?;
    let raw = raw.ok_or_else(|| AppError::NotFound(format!("cycle {cycle_id} not found")))?;

    let mut phases: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
    phases.push(serde_json::json!({
        "phase": phase,
        "status": status,
        "detail": detail,
        "at": Utc::now().to_rfc3339(),
    }));
    let encoded = serde_json::to_string(&phases)
        .map_err(|e| AppError::Internal(format!("encode cycle phases: {e}")))?;
    conn.execute(
        "UPDATE companion_cycle SET phases_json = ?1 WHERE id = ?2",
        params![encoded, cycle_id],
    )?;
    Ok(())
}

/// Close a cycle: stamp its status and stats, then persist the narrative
/// report through the full four-way memory write (disk → node → FTS mirror).
///
/// `failed` is the caller's assertion that the cycle ended badly; put the
/// reason in `stats_json` under `error` (this function does not invent one).
/// A failed cycle still gets its report written when `report_md` is non-empty
/// — the record of a bad night is worth as much as a good one.
///
/// Returns the `companion_node` id of the report, or `None` when `report_md`
/// is empty.
pub fn finish_cycle(
    pool: &UserDbPool,
    cycle_id: &str,
    status: &str,
    stats_json: &str,
    report_md: &str,
) -> Result<Option<String>, AppError> {
    if status != STATUS_COMPLETED && status != STATUS_FAILED {
        return Err(AppError::Validation(format!(
            "cycle status must be '{STATUS_COMPLETED}' or '{STATUS_FAILED}', got '{status}'"
        )));
    }
    // Reject a stats blob that is not an object up front rather than storing
    // something no consumer can read.
    if serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(stats_json).is_err() {
        return Err(AppError::Validation(
            "cycle stats_json must be a JSON object".into(),
        ));
    }

    let now = Utc::now();
    let now_str = now.to_rfc3339();

    {
        let conn = pool.get()?;
        let updated = conn.execute(
            "UPDATE companion_cycle
                SET status = ?1, stats_json = ?2, finished_at = ?3
              WHERE id = ?4",
            params![status, stats_json, now_str, cycle_id],
        )?;
        if updated == 0 {
            return Err(AppError::NotFound(format!("cycle {cycle_id} not found")));
        }
    }

    if report_md.trim().is_empty() {
        return Ok(None);
    }
    let body_md = util::excerpt(report_md, MAX_REPORT_CHARS);

    // Disk first — it is the source of truth, exactly as for episodes.
    let node_id = format!("cyr_{}", util::short_id(12));
    let rel_path = format!("cycles/{}-{}.md", now.format("%Y-%m-%d"), cycle_id);
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file_body = format_cycle_markdown(&node_id, cycle_id, status, &now_str, &body_md);
    fs::write(&abs_path, &file_body)?;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_node
           (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 4, ?5, ?6, ?6)",
        params![
            node_id,
            CYCLE_REPORT_KIND,
            rel_path,
            util::sha256_hex(&file_body),
            util::excerpt(&body_md, 500),
            now_str,
        ],
    )?;
    // Mirror into FTS. `brain::keyword` reads this table with BM25 and it is
    // the only retrieval lane on the non-ml build — a cycle report that skips
    // this write is stored and unfindable.
    conn.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
        params![
            node_id,
            body_md,
            format!("{CYCLE_REPORT_KIND} cycle:{cycle_id} status:{status}")
        ],
    )?;

    Ok(Some(node_id))
}

/// The most recent cycles, newest first.
pub fn list_recent(pool: &UserDbPool, limit: u32) -> Result<Vec<CycleSummary>, AppError> {
    let limit = limit.clamp(1, 200);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.started_at, c.finished_at, c.status, c.phases_json, c.stats_json,
                (SELECT n.id FROM companion_node n
                  WHERE n.kind = ?1 AND n.file_path LIKE '%' || c.id || '.md'
                  ORDER BY n.created_at DESC LIMIT 1)
         FROM companion_cycle c
         ORDER BY c.started_at DESC, c.rowid DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![CYCLE_REPORT_KIND, limit], |r| {
        Ok(row_to_summary(
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get::<_, String>(4)?,
            r.get(5)?,
            r.get(6)?,
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// One cycle by id, or `None`.
pub fn get(pool: &UserDbPool, cycle_id: &str) -> Result<Option<CycleSummary>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT c.id, c.started_at, c.finished_at, c.status, c.phases_json, c.stats_json,
                    (SELECT n.id FROM companion_node n
                      WHERE n.kind = ?1 AND n.file_path LIKE '%' || c.id || '.md'
                      ORDER BY n.created_at DESC LIMIT 1)
             FROM companion_cycle c WHERE c.id = ?2",
            params![CYCLE_REPORT_KIND, cycle_id],
            |r| {
                Ok(row_to_summary(
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, String>(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .optional()?;
    Ok(row)
}

fn row_to_summary(
    id: String,
    started_at: String,
    finished_at: Option<String>,
    status: String,
    phases_json: String,
    stats_json: String,
    report_node_id: Option<String>,
) -> CycleSummary {
    // A phase log that will not parse must not take the whole row down with
    // it — the status and stats are still the truth about what happened.
    let phases: Vec<CyclePhase> = serde_json::from_str::<Vec<serde_json::Value>>(&phases_json)
        .unwrap_or_default()
        .into_iter()
        .map(|v| CyclePhase {
            phase: string_field(&v, "phase"),
            status: string_field(&v, "status"),
            detail: string_field(&v, "detail"),
            at: string_field(&v, "at"),
        })
        .collect();
    CycleSummary {
        id,
        started_at,
        finished_at,
        status,
        phases,
        stats_json,
        report_node_id,
    }
}

fn string_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string()
}

fn format_cycle_markdown(
    node_id: &str,
    cycle_id: &str,
    status: &str,
    created: &str,
    body: &str,
) -> String {
    format!(
        "---\nid: \"{node_id}\"\ntype: {CYCLE_REPORT_KIND}\ncycle: \"{cycle_id}\"\nstatus: {status}\ncreated: \"{created}\"\n---\n\n{body}\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::brain::keyword;

    /// Point `disk::brain_root()` at a throwaway directory for the duration of
    /// a test. `PERSONAS_HOME` is process-global, so the guard also serializes
    /// the disk-touching tests in this module against each other.
    struct BrainHome {
        _dir: std::path::PathBuf,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    impl BrainHome {
        fn new(tag: &str) -> Self {
            let guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = std::env::temp_dir().join(format!(
                "personas_cycle_test_{tag}_{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            std::env::set_var("PERSONAS_HOME", &dir);
            Self {
                _dir: dir,
                _guard: guard,
            }
        }
    }

    impl Drop for BrainHome {
        fn drop(&mut self) {
            std::env::remove_var("PERSONAS_HOME");
        }
    }

    /// The whole lifecycle against the REAL schema (`init_test_user_db` applies
    /// `COMPANION_SCHEMA`), not a fixture the test wrote itself.
    ///
    /// Modelled on `keyword::the_real_schema_still_carries_the_index_this_lane_reads`,
    /// which exists because a test that builds its own tables stays green while
    /// production's schema breaks underneath it. Everything this substrate is
    /// for — the cycle row, the node, the disk file, the FTS mirror, and the
    /// retrieval that only works if all four landed — is asserted here.
    #[test]
    fn a_finished_cycle_is_stored_on_disk_indexed_and_retrievable_by_keyword() {
        let _home = BrainHome::new("lifecycle");
        let pool = crate::db::init_test_user_db().unwrap();

        let cycle_id = begin_cycle(&pool).expect("begin_cycle");
        let opened = get(&pool, &cycle_id).unwrap().expect("cycle exists");
        assert_eq!(opened.status, STATUS_RUNNING);
        assert!(opened.finished_at.is_none());
        assert!(opened.phases.is_empty());

        record_phase(&pool, &cycle_id, "compress", "completed", "12 episodes").unwrap();
        record_phase(&pool, &cycle_id, "reconcile", "skipped", "nothing to merge").unwrap();

        let mid = get(&pool, &cycle_id).unwrap().unwrap();
        assert_eq!(mid.status, STATUS_RUNNING, "phases do not finish a cycle");
        assert_eq!(mid.phases.len(), 2);
        assert_eq!(mid.phases[0].phase, "compress");
        assert_eq!(mid.phases[0].detail, "12 episodes");
        assert_eq!(mid.phases[1].status, "skipped");
        assert!(!mid.phases[0].at.is_empty(), "each phase is timestamped");

        let node_id = finish_cycle(
            &pool,
            &cycle_id,
            STATUS_COMPLETED,
            r#"{"facts_added":3}"#,
            "# Cycle report\n\nLearned that worktree isolation prevents stash loss.",
        )
        .expect("finish_cycle")
        .expect("a non-empty report yields a node");

        let done = get(&pool, &cycle_id).unwrap().unwrap();
        assert_eq!(done.status, STATUS_COMPLETED);
        assert!(done.finished_at.is_some());
        assert_eq!(done.stats_json, r#"{"facts_added":3}"#);
        assert_eq!(done.report_node_id.as_deref(), Some(node_id.as_str()));

        // The markdown is on disk under the brain root, with frontmatter.
        let rel: String = {
            let conn = pool.get().unwrap();
            conn.query_row(
                "SELECT file_path FROM companion_node WHERE id = ?1",
                params![node_id],
                |r| r.get(0),
            )
            .expect("the report has a companion_node row")
        };
        assert!(rel.starts_with("cycles/"), "unexpected path {rel}");
        let on_disk = std::fs::read_to_string(disk::brain_root().unwrap().join(&rel))
            .expect("the report markdown must exist on disk");
        assert!(on_disk.contains("type: cycle_report"));
        assert!(on_disk.contains("worktree isolation"));

        // And — the contract that makes it memory rather than a file — the FTS
        // mirror lands, so the keyword lane can retrieve it. This is the
        // assertion that fails if a future edit drops the mirror write.
        let hits = keyword::search_kind(&pool, "worktree isolation", CYCLE_REPORT_KIND, 5).unwrap();
        assert_eq!(
            hits,
            vec![node_id],
            "a finished cycle report must come back from the keyword lane"
        );
    }

    /// A cycle that dies stays `running`. Nothing rewrites it, because a
    /// crashed cycle and a working one are different facts and the ledger must
    /// not guess which one it is looking at.
    #[test]
    fn an_unfinished_cycle_stays_running() {
        let pool = crate::db::init_test_user_db().unwrap();
        let id = begin_cycle(&pool).unwrap();
        let recent = list_recent(&pool, 10).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, id);
        assert_eq!(recent[0].status, STATUS_RUNNING);
        assert!(recent[0].finished_at.is_none());
        assert!(recent[0].report_node_id.is_none());
    }

    /// A failed cycle is a completed observation, not a missing one: it is
    /// stamped `failed`, it keeps its error in stats, and — because the record
    /// of a bad night is worth as much as a good one — it still gets a report.
    #[test]
    fn a_failed_cycle_records_failed_with_its_reason_and_still_reports() {
        let _home = BrainHome::new("failed");
        let pool = crate::db::init_test_user_db().unwrap();
        let id = begin_cycle(&pool).unwrap();
        record_phase(&pool, &id, "compress", "failed", "CLI timeout").unwrap();

        let node = finish_cycle(
            &pool,
            &id,
            STATUS_FAILED,
            r#"{"error":"compress leg timed out after 300s"}"#,
            "# Cycle report\n\nAborted during compress: the CLI leg timed out.",
        )
        .unwrap()
        .expect("a failed cycle still writes its report");

        let c = get(&pool, &id).unwrap().unwrap();
        assert_eq!(c.status, STATUS_FAILED);
        assert!(c.finished_at.is_some(), "failing is a way of finishing");
        assert!(c.stats_json.contains("timed out"));
        assert_eq!(c.report_node_id.as_deref(), Some(node.as_str()));
        assert!(!keyword::search_kind(&pool, "aborted compress", CYCLE_REPORT_KIND, 5)
            .unwrap()
            .is_empty());
    }

    /// A cycle with nothing to say writes no node — an empty report would be a
    /// permanently empty search hit.
    #[test]
    fn an_empty_report_writes_no_node() {
        let pool = crate::db::init_test_user_db().unwrap();
        let id = begin_cycle(&pool).unwrap();
        let node = finish_cycle(&pool, &id, STATUS_COMPLETED, "{}", "   ").unwrap();
        assert!(node.is_none());
        assert_eq!(get(&pool, &id).unwrap().unwrap().status, STATUS_COMPLETED);
    }

    /// Garbage in the two free-form fields is rejected at the door rather than
    /// stored for a consumer to choke on later.
    #[test]
    fn a_bad_status_or_stats_blob_is_refused() {
        let pool = crate::db::init_test_user_db().unwrap();
        let id = begin_cycle(&pool).unwrap();
        assert!(finish_cycle(&pool, &id, "running", "{}", "").is_err());
        assert!(finish_cycle(&pool, &id, STATUS_COMPLETED, "[1,2,3]", "").is_err());
        assert!(finish_cycle(&pool, &id, STATUS_COMPLETED, "not json", "").is_err());
        // …and the cycle is untouched by the refusals.
        assert_eq!(get(&pool, &id).unwrap().unwrap().status, STATUS_RUNNING);
    }

    /// Recording a phase against a cycle that does not exist is an error, not
    /// a silent no-op: it means the caller lost its own cycle id.
    #[test]
    fn a_phase_for_an_unknown_cycle_is_an_error() {
        let pool = crate::db::init_test_user_db().unwrap();
        assert!(record_phase(&pool, "cyc_nope", "compress", "completed", "").is_err());
        assert!(finish_cycle(&pool, "cyc_nope", STATUS_COMPLETED, "{}", "body").is_err());
    }
}
