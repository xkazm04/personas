use std::sync::Arc;

use tauri::State;

use crate::db::models::PersonaTestSuite;
use crate::db::repos::execution::test_suites as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_test_suites(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaTestSuite>, AppError> {
    repo::list_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_test_suite(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaTestSuite, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_test_suite(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    name: String,
    description: Option<String>,
    scenarios: String,
    scenario_count: i32,
    source_run_id: Option<String>,
) -> Result<PersonaTestSuite, AppError> {
    repo::create(
        &state.db,
        &persona_id,
        &name,
        description.as_deref(),
        &scenarios,
        scenario_count,
        source_run_id.as_deref(),
    )
}

#[tauri::command]
pub fn update_test_suite(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    scenarios: Option<String>,
    scenario_count: Option<i32>,
) -> Result<PersonaTestSuite, AppError> {
    repo::update(
        &state.db,
        &id,
        name.as_deref(),
        description.as_deref(),
        scenarios.as_deref(),
        scenario_count,
    )
}

#[tauri::command]
pub fn delete_test_suite(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}
