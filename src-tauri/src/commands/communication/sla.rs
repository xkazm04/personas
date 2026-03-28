use std::sync::Arc;

use tauri::State;

use crate::db::models::SlaDashboardData;
use crate::db::repos::communication::sla as sla_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Returns SLA dashboard data: per-persona reliability stats, global aggregates,
/// healing summary, and daily success-rate trend.
#[tauri::command]
pub fn get_sla_dashboard(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<SlaDashboardData, AppError> {
    require_auth_sync(&state)?;
    let days = days.unwrap_or(30).clamp(1, 365);
    sla_repo::get_sla_dashboard(&state.db, days)
}
