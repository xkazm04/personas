use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreatePersonaGroupInput, PersonaGroup, UpdatePersonaGroupInput};
use crate::db::repos::core::groups as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_groups(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaGroup>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn create_group(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaGroupInput,
) -> Result<PersonaGroup, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_group(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdatePersonaGroupInput,
) -> Result<PersonaGroup, AppError> {
    require_auth_sync(&state)?;
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_group(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn reorder_groups(
    state: State<'_, Arc<AppState>>,
    ordered_ids: Vec<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::reorder(&state.db, &ordered_ids)
}
