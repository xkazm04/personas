use std::sync::Arc;

use tauri::{Manager, State};

use crate::error::AppError;

use crate::AppState;
use personas_macros::requires;

// =============================================================================
// Native Crash Logs
// =============================================================================

#[tauri::command]
#[requires(privileged)]
pub fn get_crash_logs(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<Vec<crate::logging::CrashLogEntry>, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app data dir: {e}")))?;

    Ok(crate::logging::read_crash_logs(&app_data_dir))
}

#[tauri::command]
#[requires(privileged)]
pub fn clear_crash_logs(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app data dir: {e}")))?;

    crate::logging::clear_crash_logs(&app_data_dir);
    Ok(())
}

/// Diagnostics surface: report total bytes and file counts for the rolling
/// tracing log directory and the crash log directory. Lets users see whether
/// a long-lived install is accumulating disk usage that the bounded retention
/// caps are supposed to prevent.
#[tauri::command]
#[requires(privileged)]
pub fn get_log_directory_stats(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<crate::logging::LogDirectoryStats, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app data dir: {e}")))?;

    Ok(crate::logging::log_directory_stats(&app_data_dir))
}

// =============================================================================
// Frontend Crash Telemetry
// =============================================================================

#[tauri::command]
#[requires(privileged)]
pub async fn report_frontend_crash(
    state: State<'_, Arc<AppState>>,
    component: String,
    message: String,
    stack: Option<String>,
    component_stack: Option<String>,
) -> Result<crate::db::models::FrontendCrashRow, AppError> {
    let version = env!("CARGO_PKG_VERSION").to_string();
    crate::db::repos::core::frontend_crashes::insert(
        &state.db,
        &component,
        &message,
        stack.as_deref(),
        component_stack.as_deref(),
        Some(&version),
    )
}

#[tauri::command]
#[requires(privileged)]
pub async fn get_frontend_crashes(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<crate::db::models::FrontendCrashRow>, AppError> {
    crate::db::repos::core::frontend_crashes::list_recent(&state.db, limit.unwrap_or(50))
}

#[tauri::command]
#[requires(privileged)]
pub async fn clear_frontend_crashes(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    crate::db::repos::core::frontend_crashes::clear_all(&state.db)
}

#[tauri::command]
#[requires(privileged)]
pub async fn get_frontend_crash_count(
    state: State<'_, Arc<AppState>>,
    hours: Option<u32>,
) -> Result<u32, AppError> {
    crate::db::repos::core::frontend_crashes::count_since(&state.db, hours.unwrap_or(24))
}
