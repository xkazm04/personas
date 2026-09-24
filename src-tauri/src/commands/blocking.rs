//! Run a blocking read or write (rusqlite, the filesystem) off the IPC worker.
//!
//! `.claude/rules/rust-backend.md`: "A sync command must not touch rusqlite -
//! that blocks the IPC worker. Use an async command over `spawn_blocking`."
//! Measured 2026-09-24 on the Mastermind cold open: 120+ sync list commands
//! (scans, goals, contexts, context groups, use cases, KPIs) and the
//! filesystem evidence probe queued behind one another, so a ~20 ms query took
//! ~250 ms under the fan-out. This is the one shared helper; the two private
//! copies it replaced lived in `companion/layered_voice.rs` and
//! `core/persona_brain.rs`.
use crate::error::AppError;

/// Run `f` on the blocking pool and await it. `what` names the call in the
/// error a panicked or cancelled task produces.
pub(crate) async fn run_blocking<T, F>(what: &'static str, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("{what}: task failed: {e}")))?
}
