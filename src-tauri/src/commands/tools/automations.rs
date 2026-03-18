use std::sync::Arc;
use tauri::State;

use crate::db::models::{AutomationRun, CreateAutomationInput, PersonaAutomation, UpdateAutomationInput};
use crate::db::repos::resources::automations as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use crate::commands::core::personas::BlastRadiusItem;

#[tauri::command]
pub fn list_automations(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaAutomation>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaAutomation, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_automation(
    state: State<'_, Arc<AppState>>,
    input: CreateAutomationInput,
) -> Result<PersonaAutomation, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateAutomationInput,
) -> Result<PersonaAutomation, AppError> {
    require_auth_sync(&state)?;
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn automation_blast_radius(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<BlastRadiusItem>, AppError> {
    require_auth_sync(&state)?;
    let items = repo::blast_radius(&state.db, &id)?;
    Ok(items
        .into_iter()
        .map(|(category, description)| BlastRadiusItem { category, description })
        .collect())
}

#[tauri::command]
pub fn delete_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub async fn trigger_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
    input_data: Option<String>,
    execution_id: Option<String>,
) -> Result<AutomationRun, AppError> {
    require_auth(&state).await?;
    let automation = repo::get_by_id(&state.db, &id)?;

    if !automation.deployment_status.is_runnable() {
        return Err(AppError::Validation(format!(
            "Automation '{}' is not active (status: {})",
            automation.name, automation.deployment_status
        )));
    }

    crate::engine::automation_runner::invoke_automation(
        &state.db,
        &automation,
        input_data.as_deref(),
        execution_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn test_automation_webhook(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<AutomationRun, AppError> {
    require_auth(&state).await?;
    let automation = repo::get_by_id(&state.db, &id)?;

    // For testing, we send a minimal sample payload
    let sample_input = automation
        .input_schema
        .as_deref()
        .unwrap_or(r#"{"test": true}"#);

    crate::engine::automation_runner::invoke_automation(
        &state.db,
        &automation,
        Some(sample_input),
        None,
    )
    .await
}

#[tauri::command]
pub fn get_automation_runs(
    state: State<'_, Arc<AppState>>,
    automation_id: String,
    limit: Option<i64>,
) -> Result<Vec<AutomationRun>, AppError> {
    require_auth_sync(&state)?;
    repo::get_runs_by_automation(&state.db, &automation_id, limit)
}
