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

    let total_executions: u64 = conn
        .query_row("SELECT COUNT(*) FROM persona_executions", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
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
        )
        .unwrap_or(0)
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

    Ok(StorageReport { database_bytes, total_executions, prunable_executions })
}

/// Prune terminal executions older than `older_than_hours` (default + floor 24h).
/// **Dry-run by default** — pass `dry_run = false` to actually delete.
#[tauri::command]
pub fn prune_storage(
    state: State<'_, Arc<AppState>>,
    older_than_hours: Option<u64>,
    dry_run: Option<bool>,
) -> Result<PruneResult, AppError> {
    require_auth_sync(&state)?;
    let dry_run = dry_run.unwrap_or(true);
    let age_hours = older_than_hours.unwrap_or(MIN_PRUNE_AGE_HOURS).max(MIN_PRUNE_AGE_HOURS);
    let cutoff = cutoff_rfc3339(age_hours);
    let conn = state.db.get()?;

    let where_clause = format!(
        "status IN ({TERMINAL_STATES}) AND completed_at IS NOT NULL AND completed_at < ?1"
    );

    let pruned_executions: u64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM persona_executions WHERE {where_clause}"),
            [&cutoff],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as u64;

    if !dry_run && pruned_executions > 0 {
        conn.execute(
            &format!("DELETE FROM persona_executions WHERE {where_clause}"),
            [&cutoff],
        )?;
    }

    Ok(PruneResult { dry_run, pruned_executions, age_hours })
}
