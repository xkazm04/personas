//! Layered voice IPC surface: layer-two reports, the reply register, and
//! reply-shape stats.
//!
//! Thin adapters over `companion::reports` and `companion::register`, all on
//! the companion user DB. Async over `spawn_blocking` so the rusqlite work
//! stays off the IPC worker thread. Contract:
//! `docs/features/companion/layered-voice.md`.

use std::sync::Arc;

use tauri::State;

use crate::companion::register::{self, ReplyRegisterRow};
use crate::companion::reports::{self, CompanionReport, ReplyShapeStats};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

async fn blocking<T, F>(what: &'static str, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("{what} task join failed: {e}")))?
}

/// One layer-two report, the target of a `ref:report/<id>` link.
#[tauri::command]
pub async fn companion_get_report(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<CompanionReport, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let pool = state.user_db.clone();
    blocking("companion_get_report", move || {
        reports::get_report(&pool, &id)
    })
    .await
}

/// Mark a report read (opening it in the reader). Idempotent.
#[tauri::command]
pub async fn companion_mark_report_read(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let pool = state.user_db.clone();
    blocking("companion_mark_report_read", move || {
        reports::mark_report_read(&pool, &id)
    })
    .await
}

/// Every reply-register row, `default` first. Empty = the base register.
#[tauri::command]
pub async fn companion_list_reply_register(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReplyRegisterRow>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let pool = state.user_db.clone();
    blocking("companion_list_reply_register", move || {
        register::list(&pool)
    })
    .await
}

/// How replies have been shaped over the last `days` days. Absent measures
/// are `null`, never `0`.
#[tauri::command]
pub async fn companion_reply_shape_stats(
    state: State<'_, Arc<AppState>>,
    days: u32,
) -> Result<ReplyShapeStats, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let pool = state.user_db.clone();
    blocking("companion_reply_shape_stats", move || {
        reports::reply_shape_stats(&pool, days)
    })
    .await
}
