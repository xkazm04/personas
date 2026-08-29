//! In-app storage usage + prune (fabro F5 `system df`/`prune` lesson, F18).
//!
//! Executions accumulate in SQLite over time; today the only cleanup is the
//! out-of-app `clean:worktrees` script. These commands bring fabro's storage
//! ops into the app: a usage report (`storage_usage`) and a safe prune
//! (`prune_storage`) that follows fabro's contract — **dry-run by default**, a
//! **24h minimum age floor**, **terminal-only** rows, reporting how many rows
//! would be / were removed. The UI surface is a follow-up.

use std::sync::Arc;

use serde::Serialize;
use tauri::{Manager, State};
use ts_rs::TS;

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
}

/// One table's share of a prune's blast radius.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TableImpact {
    /// Table name (a code identifier, shown verbatim).
    pub table: String,
    /// Rows this table lost when the delete executed.
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
    pub total_rows: u64,
}

fn cutoff_rfc3339(hours: u64) -> String {
    (chrono::Utc::now() - chrono::Duration::hours(hours as i64)).to_rfc3339()
}

/// Report storage usage (the `df` analogue).
#[tauri::command]
pub fn storage_usage(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<StorageReport, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;

    // Both counts PROPAGATE failure — a probe swallowed into zero would render
    // as "nothing to remove", which a safety surface must never fabricate.
    let total_executions: u64 = conn
        .query_row("SELECT COUNT(*) FROM persona_executions", [], |r| {
            r.get::<_, i64>(0)
        })?
        .max(0) as u64;

    let cutoff = cutoff_rfc3339(MIN_PRUNE_AGE_HOURS);
    let prunable_executions: u64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM persona_executions \
                 WHERE status IN ({TERMINAL_STATES}) AND completed_at IS NOT NULL AND completed_at < ?1"
            ),
            [&cutoff],
            |r| r.get::<_, i64>(0),
        )?
        .max(0) as u64;

    // Best-effort DB file size.
    let database_bytes = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("personas.db"))
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(StorageReport {
        database_bytes,
        total_executions,
        prunable_executions,
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
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
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
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| {
            r.get(0)
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
    conn: &rusqlite::Connection,
    cutoff: &str,
    dry_run: bool,
) -> Result<(u64, Vec<TableImpact>), AppError> {
    let where_clause =
        format!("status IN ({TERMINAL_STATES}) AND completed_at IS NOT NULL AND completed_at < ?1");
    let tables = countable_tables(conn)?;
    let tx = conn.unchecked_transaction()?;
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
    let conn = state.db.get()?;

    let (pruned_executions, casualties) = prune_executions(&conn, &cutoff, dry_run)?;
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
mod prune_tests {
    use super::*;
    use crate::db::init_test_db;

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
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
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
        let conn = pool.get().unwrap();
        seed(&conn);
        let cutoff = cutoff_rfc3339(MIN_PRUNE_AGE_HOURS);

        let (pruned, casualties) = prune_executions(&conn, &cutoff, true).unwrap();
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
        let conn = pool.get().unwrap();
        seed(&conn);
        let cutoff = cutoff_rfc3339(MIN_PRUNE_AGE_HOURS);

        let (predicted, predicted_casualties) = prune_executions(&conn, &cutoff, true).unwrap();
        let (actual, actual_casualties) = prune_executions(&conn, &cutoff, false).unwrap();
        assert_eq!(predicted, actual);
        assert_eq!(predicted_casualties, actual_casualties);

        assert_eq!(count(&conn, "persona_executions"), 1);
        assert_eq!(count(&conn, "persona_tool_usage"), 1);

        // Idempotent: a second act finds nothing prunable.
        let (again, again_casualties) = prune_executions(&conn, &cutoff, false).unwrap();
        assert_eq!(again, 0);
        assert!(again_casualties.is_empty());
    }
}
