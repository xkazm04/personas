use std::sync::Arc;

use tauri::State;

use crate::db::models::SlaDashboardData;
use crate::db::repos::communication::sla as sla_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Returns SLA dashboard data: per-persona reliability stats, global aggregates,
/// healing summary, and daily success-rate trend.
///
/// `utc_offset_minutes` is the frontend's timezone offset east of UTC
/// (`-new Date().getTimezoneOffset()`). It drives local-day bucketing for the
/// trend and the local-day-aligned window boundary so a non-UTC user's days and
/// "last N days" match their wall clock. When omitted, the backend falls back to
/// the server's own local offset (identical on a local-first desktop).
#[tauri::command]
pub fn get_sla_dashboard(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    utc_offset_minutes: Option<i64>,
) -> Result<SlaDashboardData, AppError> {
    require_auth_sync(&state)?;
    let days = days.unwrap_or(30).clamp(1, 365);
    let offset_min = utc_offset_minutes
        .map(|m| m.clamp(-14 * 60, 14 * 60))
        .unwrap_or_else(sla_repo::server_offset_minutes);
    sla_repo::get_sla_dashboard_with_offset(&state.db, days, offset_min)
}
