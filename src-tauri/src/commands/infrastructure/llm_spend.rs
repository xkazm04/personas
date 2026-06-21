use std::sync::Arc;
use tauri::State;

use crate::db::models::LlmSpendDashboard;
use crate::db::repos::llm_spend as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Headless LLM spend dashboard (tiger finding #1): cost / token rollups for the
/// background scanner / evaluator / design tiers (the `dev_llm_spend` ledger)
/// over the last `window_days` (default 30, clamped 1..=365). Separate from the
/// companion (Athena) usage dashboard, which reads `companion_turn`.
#[tauri::command]
pub fn llm_spend_dashboard(
    state: State<'_, Arc<AppState>>,
    window_days: Option<i64>,
) -> Result<LlmSpendDashboard, AppError> {
    require_auth_sync(&state)?;
    repo::dashboard(&state.db, window_days.unwrap_or(30))
}
