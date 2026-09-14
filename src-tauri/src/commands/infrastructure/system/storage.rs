//! In-app storage usage + prune (fabro F5 `system df`/`prune` lesson, F18).
//!
//! Executions accumulate in SQLite over time; today the only cleanup is the
//! out-of-app `clean:worktrees` script. These commands bring fabro's storage
//! ops into the app: a usage report (`storage_usage`) and a safe prune
//! (`prune_storage`) that follows fabro's contract — **dry-run by default**, a
//! **24h minimum age floor**, **terminal-only** rows, reporting how many rows
//! would be / were removed.
//!
//! The report covers the whole footprint beside the database, not only the
//! file: the free pages inside it, its WAL, `backups/` and `logs/` (measured
//! 2026-09-14: 347 MB database, 996 MB of backups and ~400 MB of logs, while
//! the old report showed only the first). `reclaim_storage` gives the free
//! pages back through the same contract as the prune — a dry-run preview first,
//! then the act — on top of `db::reclaim`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::{reclaim, DbPool};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Minimum age (hours) below which executions are never pruned — protects recent
/// and in-flight work even if a caller asks for a smaller window.
const MIN_PRUNE_AGE_HOURS: u64 = 24;

/// Terminal execution states that are safe to prune. Deliberately an allow-list
/// (never `NOT IN ('running', …)`) so an unknown/active state is never deleted.
const TERMINAL_STATES: &str = "'completed','failed','cancelled','incomplete'";

/// A point-in-time storage usage report.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StorageReport {
    /// Size of the operational SQLite database file, in bytes.
    pub database_bytes: u64,
    /// Total execution rows.
    pub total_executions: u64,
    /// Terminal execution rows older than the 24h floor (prunable now).
    pub prunable_executions: u64,
    /// Free pages inside the database file (`freelist_count × page_size`) —
    /// what "reclaim space" gives back at least. Bounded by the file size, so
    /// the wire carries a JS number.
    #[ts(type = "number")]
    pub database_free_bytes: u64,
    /// The write-ahead log beside the database.
    #[ts(type = "number")]
    pub wal_bytes: u64,
    /// Every file in `backups/` (sets and their sidecars).
    #[ts(type = "number")]
    pub backups_bytes: u64,
    /// `.db` sets in `backups/`.
    pub backup_sets: u32,
    /// Every file in `logs/` (execution logs, rolling tracing logs).
    #[ts(type = "number")]
    pub logs_bytes: u64,
    pub log_files: u32,
}

/// Result of reclaiming the database's free pages (or a dry-run preview).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimResult {
    /// True when nothing was rewritten (preview only).
    pub dry_run: bool,
    /// The main database file before, in bytes. A JS number on the wire.
    #[ts(type = "number")]
    pub database_bytes_before: u64,
    /// Free pages a compaction gives back at least — the preview's promise.
    #[ts(type = "number")]
    pub reclaimable_bytes: u64,
    /// The executions search index is (or was) merged first.
    pub search_index_bloated: bool,
    /// The main database file after; equal to `database_bytes_before` on a
    /// dry run.
    #[ts(type = "number")]
    pub database_bytes_after: u64,
    #[ts(type = "number")]
    pub elapsed_ms: u64,
}

/// One table's share of a prune's blast radius.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TableImpact {
    /// Table name (a code identifier, shown verbatim).
    pub table: String,
    /// Rows this table lost when the delete executed. Bounded far under 2^53
    /// (a single prune's casualties), so the wire carries a JS number.
    #[ts(type = "number")]
    pub rows: u64,
}

/// Result of a prune (or a dry-run preview of one).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    /// True when nothing was actually deleted (preview only).
    pub dry_run: bool,
    /// Terminal rows older than the cutoff that were (or would be) removed.
    pub pruned_executions: u64,
    /// The effective age floor applied (hours).
    pub age_hours: u64,
    /// Every table that shrank when the DELETE executed — the cascade set,
    /// tallied THROUGH THE ENFORCEMENT PATH (the real delete ran inside a
    /// transaction; a dry-run rolls it back), so preview and act cannot
    /// diverge by construction. Largest first.
    pub casualties: Vec<TableImpact>,
    /// Sum over `casualties` — the honest total the confirm copy shows.
    /// Same bound as [`TableImpact::rows`]; a JS number on the wire.
    #[ts(type = "number")]
    pub total_rows: u64,
}

fn cutoff_rfc3339(hours: u64) -> String {
    (chrono::Utc::now() - chrono::Duration::hours(hours as i64)).to_rfc3339()
}

/// Report storage usage (the `df` analogue). Async over `spawn_blocking`: it
/// reads the database and walks two directories, neither of which belongs on
/// the IPC thread.
#[tauri::command]
pub async fn storage_usage(state: State<'_, Arc<AppState>>) -> Result<StorageReport, AppError> {
    require_auth_sync(&state)?;
    let pool = state.db.clone();
    off_ipc_thread("storage_usage", move || build_storage_report(&pool)).await
}

/// Run blocking storage work off the IPC thread and keep its handle, so a
/// panic inside it becomes this command's error instead of vanishing with a
/// dropped `JoinHandle`.
async fn off_ipc_thread<T, F>(label: &'static str, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    match tokio::task::spawn_blocking(work).await {
        Ok(result) => result,
        Err(join) if join.is_panic() => Err(AppError::Internal(format!(
            "{label}: the storage worker panicked"
        ))),
        Err(join) => Err(AppError::Internal(format!(
            "{label}: the storage worker was cancelled: {join}"
        ))),
    }
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// `(bytes, files, .db files)` of a flat directory; zeros when it is absent.
fn flat_dir_totals(dir: &Path) -> (u64, u32, u32) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (0, 0, 0);
    };
    let mut totals = (0u64, 0u32, 0u32);
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        totals.0 = totals.0.saturating_add(meta.len());
        totals.1 = totals.1.saturating_add(1);
        if entry.path().extension().is_some_and(|x| x == "db") {
            totals.2 = totals.2.saturating_add(1);
        }
    }
    totals
}

fn build_storage_report(pool: &DbPool) -> Result<StorageReport, AppError> {
    let conn = pool.get()?;

    // Both counts PROPAGATE failure — a probe swallowed into zero would render
    // as "nothing to remove", which a safety surface must never fabricate.
    let total_executions: u64 = conn
        .query_row("SELECT COUNT(*) AS n FROM persona_executions", [], |r| {
            r.get::<_, i64>("n")
        })?
        .max(0) as u64;

    let cutoff = cutoff_rfc3339(MIN_PRUNE_AGE_HOURS);
    let prunable_executions: u64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) AS n FROM persona_executions \
                 WHERE status IN ({TERMINAL_STATES}) AND completed_at IS NOT NULL AND completed_at < ?1"
            ),
            [&cutoff],
            |r| r.get::<_, i64>("n"),
        )?
        .max(0) as u64;

    // The space picture propagates too: "0 reclaimable" is a claim.
    let space = reclaim::estimate(&conn)?;

    // Everything else is read beside the file this connection actually has
    // open, so the numbers follow a PERSONAS_DATA_DIR override exactly as the
    // database does. Sizes are best-effort: a file that cannot be stat'ed is
    // reported as empty rather than failing the whole report.
    let db_path = conn.path().map(PathBuf::from);
    let database_bytes = db_path
        .as_deref()
        .map(file_len)
        .unwrap_or(space.database_bytes);
    let wal_bytes = db_path
        .as_deref()
        .map(|p| file_len(&PathBuf::from(format!("{}-wal", p.display()))))
        .unwrap_or(0);
    let data_dir = db_path.as_deref().and_then(Path::parent);
    let (backups_bytes, _, backup_sets) = data_dir
        .map(|d| flat_dir_totals(&d.join("backups")))
        .unwrap_or_default();
    let (logs_bytes, log_files, _) = data_dir
        .map(|d| flat_dir_totals(&d.join("logs")))
        .unwrap_or_default();

    Ok(StorageReport {
        database_bytes,
        total_executions,
        prunable_executions,
        database_free_bytes: space.free_bytes,
        wal_bytes,
        backups_bytes,
        backup_sets,
        logs_bytes,
        log_files,
    })
}

/// Give the database's free pages back to the disk: merge a bloated search
/// index, then `VACUUM`. **Dry-run by default** — the preview reports what
/// would be reclaimed and rewrites nothing; `dry_run = false` performs it.
/// Writers wait for the length of the compaction (measured 4.4 s on a 347 MB
/// database), which is why this is an explicit act behind a preview.
#[tauri::command]
pub async fn reclaim_storage(
    state: State<'_, Arc<AppState>>,
    dry_run: Option<bool>,
) -> Result<ReclaimResult, AppError> {
    require_auth_sync(&state)?;
    let dry_run = dry_run.unwrap_or(true);
    let pool = state.db.clone();
    off_ipc_thread("reclaim_storage", move || reclaim_database(&pool, dry_run)).await
}

/// The shared path behind both modes of [`reclaim_storage`].
pub fn reclaim_database(pool: &DbPool, dry_run: bool) -> Result<ReclaimResult, AppError> {
    let conn = pool.get()?;
    if dry_run {
        let estimate = reclaim::estimate(&conn)?;
        return Ok(ReclaimResult {
            dry_run,
            database_bytes_before: estimate.database_bytes,
            reclaimable_bytes: estimate.free_bytes,
            search_index_bloated: estimate.search_index_bloated(),
            database_bytes_after: estimate.database_bytes,
            elapsed_ms: 0,
        });
    }
    let outcome = reclaim::reclaim(&conn)?;
    Ok(ReclaimResult {
        dry_run,
        database_bytes_before: outcome.before.database_bytes,
        reclaimable_bytes: outcome.before.free_bytes,
        search_index_bloated: outcome.before.search_index_bloated(),
        database_bytes_after: outcome.after.database_bytes,
        elapsed_ms: outcome.elapsed_ms,
    })
}

/// Tables whose row deltas a prune tallies: every ordinary table plus the
/// executions FTS index itself. FTS5 shadow internals (`executions_fts_data`
/// etc.) hold storage blocks rather than user rows, so counting them would
/// inflate the honest number with bookkeeping.
fn countable_tables(conn: &rusqlite::Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE '%_fts_%'
         ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>("name"))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// `COUNT(*)` per table. A failed probe PROPAGATES — a count swallowed into
/// zero would render as "no dependents, safe to delete", the one failure mode
/// a safety surface cannot have (failure-not-empty-success).
fn table_counts(
    conn: &rusqlite::Connection,
    tables: &[String],
) -> Result<Vec<(String, u64)>, AppError> {
    let mut out = Vec::with_capacity(tables.len());
    for table in tables {
        let n: i64 =
            conn.query_row(&format!("SELECT COUNT(*) AS n FROM \"{table}\""), [], |r| {
                r.get("n")
            })?;
        out.push((table.clone(), n.max(0) as u64));
    }
    Ok(out)
}

/// The enforcement-path prune shared by preview and act (deferred-fixes #31;
/// registry `entity-lifecycle/blast-radius-computation`, 2026-08-29 amendment:
/// "sharing the predicate is still not sharing the effect"). The real DELETE
/// executes inside a transaction with foreign keys ON, casualties are tallied
/// per table by diffing row counts — which SEES the FK cascade and the FTS
/// trigger, unlike any count on the target table — and the mode decides only
/// the final verb: ROLLBACK for a dry-run, COMMIT for the act.
pub fn prune_executions(
    conn: &mut rusqlite::Connection,
    cutoff: &str,
    dry_run: bool,
) -> Result<(u64, Vec<TableImpact>), AppError> {
    let where_clause =
        format!("status IN ({TERMINAL_STATES}) AND completed_at IS NOT NULL AND completed_at < ?1");
    let tables = countable_tables(conn)?;
    // BEGIN IMMEDIATE: the before-counts inform the delete's accounting, and
    // the preview's honesty depends on counts and delete seeing one world
    // (transaction-boundary golden path - a deferred snapshot cannot upgrade
    // past a concurrent committer).
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let before = table_counts(&tx, &tables)?;
    let pruned_executions = tx.execute(
        &format!("DELETE FROM persona_executions WHERE {where_clause}"),
        [&cutoff],
    )? as u64;
    let after = table_counts(&tx, &tables)?;
    if dry_run {
        tx.rollback()?;
    } else {
        tx.commit()?;
        // The FTS delete trigger only tombstones the pruned rows; merge the
        // index so the prune actually gives their postings back. A failed
        // merge costs space, never correctness, so it does not fail the prune.
        if pruned_executions > 0 {
            if let Err(e) = reclaim::optimize_search_index_on(conn) {
                tracing::warn!(error = %e, "executions_fts optimize after prune failed");
            }
        }
    }
    let mut casualties: Vec<TableImpact> = before
        .iter()
        .zip(after.iter())
        .filter(|((_, b), (_, a))| b > a)
        .map(|((table, b), (_, a))| TableImpact {
            table: table.clone(),
            rows: b - a,
        })
        .collect();
    casualties.sort_by(|x, y| y.rows.cmp(&x.rows).then_with(|| x.table.cmp(&y.table)));
    Ok((pruned_executions, casualties))
}

/// Prune terminal executions older than `older_than_hours` (default + floor 24h).
/// **Dry-run by default** — pass `dry_run = false` to actually delete. Both
/// modes run the identical enforcement path ([`prune_executions`]); the result
/// doubles as the preview (dry-run) and the receipt (act).
#[tauri::command]
pub fn prune_storage(
    state: State<'_, Arc<AppState>>,
    older_than_hours: Option<u64>,
    dry_run: Option<bool>,
) -> Result<PruneResult, AppError> {
    require_auth_sync(&state)?;
    let dry_run = dry_run.unwrap_or(true);
    let age_hours = older_than_hours
        .unwrap_or(MIN_PRUNE_AGE_HOURS)
        .max(MIN_PRUNE_AGE_HOURS);
    let cutoff = cutoff_rfc3339(age_hours);
    let mut conn = state.db.get()?;

    let (pruned_executions, casualties) = prune_executions(&mut conn, &cutoff, dry_run)?;
    let total_rows = casualties.iter().map(|c| c.rows).sum();

    Ok(PruneResult {
        dry_run,
        pruned_executions,
        age_hours,
        casualties,
        total_rows,
    })
}

#[cfg(test)]
mod reclaim_tests {
    use super::*;
    use crate::db::{init_test_db, PoolExt};

    /// Leave ~16 MB on the freelist.
    fn churn(pool: &DbPool) {
        let conn = pool.conn("storage::reclaim_tests").unwrap();
        let blob = "x".repeat(16 * 1024);
        for i in 0..1000 {
            conn.execute(
                "INSERT INTO execution_traces (id, execution_id, trace_id, persona_id, spans)
                 VALUES (?1, 'e-churn', 't', 'p', ?2)",
                rusqlite::params![format!("churn-{i}"), blob],
            )
            .unwrap();
        }
        conn.execute(
            "DELETE FROM execution_traces WHERE execution_id = 'e-churn'",
            [],
        )
        .unwrap();
    }

    /// The preview promises what the act delivers, and rewrites nothing itself.
    #[test]
    fn dry_run_reports_the_freelist_and_the_act_gives_it_back() {
        let pool = init_test_db().unwrap();
        churn(&pool);

        let preview = reclaim_database(&pool, true).unwrap();
        assert!(preview.dry_run);
        assert!(preview.reclaimable_bytes >= 8 * 1024 * 1024, "{preview:?}");
        assert_eq!(preview.database_bytes_after, preview.database_bytes_before);
        let again = reclaim_database(&pool, true).unwrap();
        assert_eq!(
            again.reclaimable_bytes, preview.reclaimable_bytes,
            "a dry run must not rewrite the file"
        );

        let receipt = reclaim_database(&pool, false).unwrap();
        assert!(!receipt.dry_run);
        assert!(
            receipt.database_bytes_after + preview.reclaimable_bytes
                <= receipt.database_bytes_before + 4096 * 8,
            "the act gives back what the preview promised: {receipt:?}"
        );
        assert_eq!(reclaim_database(&pool, true).unwrap().reclaimable_bytes, 0);
    }

    /// The report reads the free pages of the file it has open.
    #[test]
    fn the_report_carries_the_database_free_bytes() {
        let pool = init_test_db().unwrap();
        churn(&pool);
        let report = build_storage_report(&pool).unwrap();
        assert!(report.database_bytes > 0);
        assert!(report.database_free_bytes >= 8 * 1024 * 1024, "{report:?}");
        assert!(report.database_free_bytes <= report.database_bytes);
    }
}

#[cfg(test)]
mod prune_tests {
    use super::*;
    use crate::db::{init_test_db, PoolExt};

    fn seed(conn: &rusqlite::Connection) {
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p1', 'Prune Test', 'sp', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        // Two prunable terminal runs (old), one recent run the floor protects.
        conn.execute_batch(
            "INSERT INTO persona_executions (id, persona_id, status, completed_at, created_at)
             VALUES ('e-old-1', 'p1', 'completed', datetime('now', '-3 days'), datetime('now', '-3 days'));
             INSERT INTO persona_executions (id, persona_id, status, completed_at, created_at)
             VALUES ('e-old-2', 'p1', 'failed', datetime('now', '-2 days'), datetime('now', '-2 days'));
             INSERT INTO persona_executions (id, persona_id, status, completed_at, created_at)
             VALUES ('e-new', 'p1', 'completed', datetime('now'), datetime('now'));
             -- Cascade children the target-table count can never see.
             INSERT INTO persona_tool_usage (id, execution_id, persona_id, tool_name, created_at)
             VALUES ('tu1', 'e-old-1', 'p1', 'Bash', datetime('now', '-3 days'));
             INSERT INTO persona_tool_usage (id, execution_id, persona_id, tool_name, created_at)
             VALUES ('tu2', 'e-old-2', 'p1', 'Read', datetime('now', '-2 days'));
             INSERT INTO persona_tool_usage (id, execution_id, persona_id, tool_name, created_at)
             VALUES ('tu3', 'e-new', 'p1', 'Edit', datetime('now'));",
        )
        .unwrap();
    }

    fn count(conn: &rusqlite::Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
            r.get("n")
        })
        .unwrap()
    }

    fn casualty(casualties: &[TableImpact], table: &str) -> Option<u64> {
        casualties.iter().find(|c| c.table == table).map(|c| c.rows)
    }

    /// The dry-run IS the enforcement path: it must see the cascade (the
    /// 3.29× class the shared-predicate count missed) and delete nothing.
    #[test]
    fn dry_run_sees_the_cascade_and_deletes_nothing() {
        let pool = init_test_db().unwrap();
        let mut conn = pool.conn("storage::prune_tests").unwrap();
        seed(&conn);
        let cutoff = cutoff_rfc3339(MIN_PRUNE_AGE_HOURS);

        let (pruned, casualties) = prune_executions(&mut conn, &cutoff, true).unwrap();
        assert_eq!(pruned, 2);
        assert_eq!(casualty(&casualties, "persona_executions"), Some(2));
        assert_eq!(
            casualty(&casualties, "persona_tool_usage"),
            Some(2),
            "the preview must see the FK cascade, not just the target table"
        );
        // Rolled back: nothing actually left.
        assert_eq!(count(&conn, "persona_executions"), 3);
        assert_eq!(count(&conn, "persona_tool_usage"), 3);
    }

    /// Preview and act share one implementation: on an unchanged DB the act's
    /// receipt equals the dry-run's prediction, and the floor-protected recent
    /// run (and its child) survive.
    #[test]
    fn act_receipt_matches_the_dry_run_prediction() {
        let pool = init_test_db().unwrap();
        let mut conn = pool.conn("storage::prune_tests").unwrap();
        seed(&conn);
        let cutoff = cutoff_rfc3339(MIN_PRUNE_AGE_HOURS);

        let (predicted, predicted_casualties) = prune_executions(&mut conn, &cutoff, true).unwrap();
        let (actual, actual_casualties) = prune_executions(&mut conn, &cutoff, false).unwrap();
        assert_eq!(predicted, actual);
        assert_eq!(predicted_casualties, actual_casualties);

        assert_eq!(count(&conn, "persona_executions"), 1);
        assert_eq!(count(&conn, "persona_tool_usage"), 1);

        // Idempotent: a second act finds nothing prunable.
        let (again, again_casualties) = prune_executions(&mut conn, &cutoff, false).unwrap();
        assert_eq!(again, 0);
        assert!(again_casualties.is_empty());
    }
}
