use std::sync::Arc;
use tauri::State;

use crate::engine::background::{self, SchedulerStats};
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn get_scheduler_status(
    state: State<'_, Arc<AppState>>,
) -> Result<SchedulerStats, AppError> {
    Ok(state.scheduler.stats())
}

#[tauri::command]
pub async fn start_scheduler(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<SchedulerStats, AppError> {
    if state.scheduler.is_running() {
        return Ok(state.scheduler.stats());
    }

    background::start_loops(
        state.scheduler.clone(),
        app,
        state.db.clone(),
        state.engine.clone(),
        state.rate_limiter.clone(),
    );

    Ok(state.scheduler.stats())
}

#[tauri::command]
pub fn stop_scheduler(
    state: State<'_, Arc<AppState>>,
) -> Result<SchedulerStats, AppError> {
    background::stop_loops(&state.scheduler);
    Ok(state.scheduler.stats())
}
