use crate::db::repos::execution::executions as exec_repo;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Zombie execution sweep
// ---------------------------------------------------------------------------

/// Tauri event emitted when zombie executions are detected and transitioned.
#[derive(Clone, Serialize)]
pub struct ZombieExecutionEvent {
    /// IDs of executions that were transitioned to incomplete.
    pub zombie_ids: Vec<String>,
    /// Number of zombies found in this sweep.
    pub count: usize,
}

/// Tauri event emitted when executions are running but have not heartbeated
/// recently. This is a passive signal only — no status change happens. The
/// existing zombie sweep + hard `timeout_ms` are still authoritative for
/// terminating runs; this event surfaces a "looks alive but quiet" warning
/// so the UI can show it earlier than the hard kill, and so healing can
/// proactively act before the watchdog terminates the run.
#[derive(Clone, Serialize)]
pub struct SilentExecutionEvent {
    /// IDs of executions whose last heartbeat is older than the cutoff.
    pub execution_ids: Vec<String>,
    /// Number of silent runs found in this sweep.
    pub count: usize,
    /// Cutoff threshold in seconds applied for this sweep.
    pub cutoff_secs: i64,
}

/// One tick of the zombie execution sweep: find executions stuck in 'running'
/// beyond the threshold and transition them to 'incomplete'.
pub(crate) fn zombie_execution_tick(pool: &DbPool, app: &AppHandle) {
    match exec_repo::sweep_zombie_executions(pool) {
        Ok(zombie_ids) => {
            if !zombie_ids.is_empty() {
                let count = zombie_ids.len();
                tracing::warn!(
                    count,
                    ids = ?zombie_ids,
                    "Zombie execution sweep: transitioned {} stale executions to incomplete",
                    count,
                );
                let _ = app.emit(
                    event_name::ZOMBIE_EXECUTIONS_DETECTED,
                    ZombieExecutionEvent { zombie_ids, count },
                );
            }
        }
        Err(e) => {
            tracing::error!("Zombie execution sweep failed: {}", e);
        }
    }
}

/// Threshold (seconds) of stream silence before a still-running execution is
/// reported as `silent`. Set well below the zombie threshold so the silent
/// signal fires earlier and gives the UI / healing a chance to react before
/// the zombie sweep transitions the run to `incomplete`.
const SILENT_EXECUTION_THRESHOLD_SECS: i64 = 90;

/// Cap on how many silent executions a single sweep emits, so a wedged
/// runner pool can't flood the frontend.
const SILENT_EXECUTION_BATCH_LIMIT: i64 = 50;

/// One tick of the silent-execution watchdog: find runs whose last heartbeat
/// is older than `SILENT_EXECUTION_THRESHOLD_SECS` and emit a passive event.
/// No status change is performed — the existing zombie sweep + hard
/// `timeout_ms` remain authoritative for terminating runs.
pub(crate) fn silent_execution_tick(pool: &DbPool, app: &AppHandle) {
    let cutoff_dt = chrono::Utc::now() - chrono::Duration::seconds(SILENT_EXECUTION_THRESHOLD_SECS);
    let cutoff = cutoff_dt.to_rfc3339();
    match exec_repo::find_silent_running(pool, &cutoff, SILENT_EXECUTION_BATCH_LIMIT) {
        Ok(execution_ids) => {
            if !execution_ids.is_empty() {
                let count = execution_ids.len();
                tracing::info!(
                    count,
                    cutoff_secs = SILENT_EXECUTION_THRESHOLD_SECS,
                    "Silent-execution sweep: {} runs without heartbeat past cutoff",
                    count,
                );
                let _ = app.emit(
                    event_name::EXECUTIONS_SILENT_DETECTED,
                    SilentExecutionEvent {
                        execution_ids,
                        count,
                        cutoff_secs: SILENT_EXECUTION_THRESHOLD_SECS,
                    },
                );
            }
        }
        Err(e) => {
            tracing::error!("Silent-execution sweep failed: {}", e);
        }
    }
}
