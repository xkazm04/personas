use std::sync::Arc;
use tauri::State;

use crate::engine::digest::{self, DigestConfig, PerformanceDigest};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Get the current digest configuration.
#[tauri::command]
pub fn get_digest_config(
    state: State<'_, Arc<AppState>>,
) -> Result<DigestConfig, AppError> {
    require_auth_sync(&state)?;
    Ok(digest::load_config(&state.db))
}

/// Update the digest configuration.
#[tauri::command]
pub fn set_digest_config(
    state: State<'_, Arc<AppState>>,
    config: DigestConfig,
) -> Result<DigestConfig, AppError> {
    require_auth_sync(&state)?;
    digest::save_config(&state.db, &config)?;
    Ok(config)
}

/// Generate a digest preview without delivering it.
#[tauri::command]
pub fn preview_digest(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<PerformanceDigest, AppError> {
    require_auth_sync(&state)?;
    let period_days = days.unwrap_or(7).clamp(1, 30);
    Ok(digest::generate_digest(&state.db, period_days))
}

/// Manually trigger a digest delivery (bypasses schedule check).
#[tauri::command]
pub fn send_digest_now(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    digest::deliver_digest(&state.db, &app);
    Ok(())
}
