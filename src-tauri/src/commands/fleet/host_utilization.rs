//! Tauri commands for whole-machine utilisation and the standup forecast
//! (spark app-standup). WP2 owns this file.
//!
//! WP0 froze the signatures; the bodies are stubs until WP2 lands the
//! `host_utilization` repo (system DB, migration `e73_host_utilization`), the
//! sampler (`engine::resources::host_sampler`) and the forecast
//! (`companion::standup::forecast`). Both commands are adapters.

use std::sync::Arc;

use tauri::State;

use crate::db::models::{ForecastSlot, HostUtilizationPoint};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The 1-minute host rollups with `since_ms <= minute_ms < until_ms`, oldest
/// first.
#[tauri::command]
pub async fn host_utilization_series(
    state: State<'_, Arc<AppState>>,
    since_ms: i64,
    until_ms: i64,
) -> Result<Vec<HostUtilizationPoint>, AppError> {
    require_auth(&state).await?;
    let _ = (since_ms, until_ms);
    Ok(Vec::new())
}

/// Where each item of the standup's plan is expected to run.
#[tauri::command]
pub async fn standup_forecast(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
) -> Result<Vec<ForecastSlot>, AppError> {
    require_auth(&state).await?;
    let _ = standup_id;
    Err(AppError::Execution(
        "standup_forecast: not implemented: WP2".to_string(),
    ))
}
