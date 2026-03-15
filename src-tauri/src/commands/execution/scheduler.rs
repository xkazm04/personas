use std::sync::Arc;
use tauri::State;

use crate::engine::background::{self, SchedulerStats};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub fn get_scheduler_status(
    state: State<'_, Arc<AppState>>,
) -> Result<SchedulerStats, AppError> {
    require_auth_sync(&state)?;
    Ok(state.scheduler.stats())
}

#[tauri::command]
pub async fn start_scheduler(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<SchedulerStats, AppError> {
    require_auth(&state).await?;
    if state.scheduler.is_running() {
        return Ok(state.scheduler.stats());
    }

    background::start_loops(
        state.scheduler.clone(),
        app,
        state.db.clone(),
        state.engine.clone(),
        state.rate_limiter.clone(),
        state.tier_config.clone(),
        state.cloud_client.clone(),
    );

    Ok(state.scheduler.stats())
}

#[tauri::command]
pub fn stop_scheduler(
    state: State<'_, Arc<AppState>>,
) -> Result<SchedulerStats, AppError> {
    require_auth_sync(&state)?;
    background::stop_loops(&state.scheduler);
    Ok(state.scheduler.stats())
}
