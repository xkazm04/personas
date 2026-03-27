use std::sync::Arc;

use tauri::{Manager, State};

use crate::error::AppError;
use crate::AppState;

// =============================================================================
// Native Crash Logs
// =============================================================================

#[tauri::command]
pub fn get_crash_logs(app: tauri::AppHandle) -> Result<Vec<crate::logging::CrashLogEntry>, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app data dir: {e}")))?;

    Ok(crate::logging::read_crash_logs(&app_data_dir))
}

#[tauri::command]
pub fn clear_crash_logs(app: tauri::AppHandle) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app data dir: {e}")))?;

    crate::logging::clear_crash_logs(&app_data_dir);
    Ok(())
}

// =============================================================================
// Frontend Crash Telemetry
// =============================================================================

#[tauri::command]
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
pub async fn get_frontend_crashes(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<crate::db::models::FrontendCrashRow>, AppError> {
    crate::db::repos::core::frontend_crashes::list_recent(&state.db, limit.unwrap_or(50))
}

#[tauri::command]
pub async fn clear_frontend_crashes(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    crate::db::repos::core::frontend_crashes::clear_all(&state.db)
}

#[tauri::command]
pub async fn get_frontend_crash_count(
    state: State<'_, Arc<AppState>>,
    hours: Option<u32>,
) -> Result<u32, AppError> {
    crate::db::repos::core::frontend_crashes::count_since(&state.db, hours.unwrap_or(24))
}
