use std::sync::Arc;
use tauri::State;

use crate::db::models::{PersonaMetricsSnapshot, PersonaPromptVersion};
use crate::db::repos::execution::metrics as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn get_metrics_summary(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<serde_json::Value, AppError> {
    repo::get_summary(&state.db, days)
}

#[tauri::command]
pub fn get_metrics_snapshots(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<PersonaMetricsSnapshot>, AppError> {
    repo::get_snapshots(
        &state.db,
        persona_id.as_deref(),
        start_date.as_deref(),
        end_date.as_deref(),
    )
}

#[tauri::command]
pub fn get_live_metrics_timeseries(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
) -> Result<Vec<PersonaMetricsSnapshot>, AppError> {
    repo::get_live_timeseries(&state.db, days, persona_id.as_deref())
}

#[tauri::command]
pub fn get_prompt_versions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaPromptVersion>, AppError> {
    repo::get_prompt_versions(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn get_all_monthly_spend(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<(String, f64)>, AppError> {
    let personas = crate::db::repos::core::personas::get_all(&state.db)?;
    let mut result = Vec::new();
    for persona in &personas {
        let spend = crate::db::repos::execution::executions::get_monthly_spend(&state.db, &persona.id)?;
        result.push((persona.id.clone(), spend));
    }
    Ok(result)
}
