use std::sync::Arc;
use tauri::State;

use crate::db::models::{AssertionResult, ExecutionAssertionSummary, OutputAssertion};
use crate::db::repos::execution::assertions as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// -- Assertion Definition CRUD --

#[tauri::command]
pub fn list_output_assertions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<OutputAssertion>, AppError> {
    require_auth_sync(&state)?;
    repo::list_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_output_assertion(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<OutputAssertion, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_output_assertion(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    name: String,
    description: Option<String>,
    assertion_type: String,
    config: String,
    severity: Option<String>,
    on_failure: Option<String>,
) -> Result<OutputAssertion, AppError> {
    require_auth_sync(&state)?;
    repo::create(
        &state.db,
        &persona_id,
        &name,
        description.as_deref(),
        &assertion_type,
        &config,
        severity.as_deref(),
        on_failure.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_output_assertion(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    config: Option<String>,
    severity: Option<String>,
    on_failure: Option<String>,
    enabled: Option<bool>,
) -> Result<OutputAssertion, AppError> {
    require_auth_sync(&state)?;
    repo::update(
        &state.db,
        &id,
        name.as_deref(),
        description.as_deref(),
        config.as_deref(),
        severity.as_deref(),
        on_failure.as_deref(),
        enabled,
    )
}

#[tauri::command]
pub fn delete_output_assertion(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

// -- Assertion Results --

#[tauri::command]
pub fn get_assertion_results_for_execution(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<ExecutionAssertionSummary, AppError> {
    require_auth_sync(&state)?;
    repo::get_summary_by_execution(&state.db, &execution_id)
}

#[tauri::command]
pub fn get_assertion_result_history(
    state: State<'_, Arc<AppState>>,
    assertion_id: String,
    limit: Option<i64>,
) -> Result<Vec<AssertionResult>, AppError> {
    require_auth_sync(&state)?;
    repo::get_results_by_assertion(&state.db, &assertion_id, limit)
}
