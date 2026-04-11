//! Tauri commands for composition workflow CRUD.
//!
//! Thin wrappers around the repo layer — business logic lives in the repo.

use std::sync::Arc;

use tauri::State;

use crate::db::models::composition_workflow::{
    CreateCompositionWorkflowInput, UpdateCompositionWorkflowInput,
};
use crate::db::models::CompositionWorkflow;
use crate::db::repos::resources::composition_workflows as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_composition_workflows(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CompositionWorkflow>, AppError> {
    require_auth_sync(&state)?;
    repo::list_all(&state.db)
}

#[tauri::command]
pub fn get_composition_workflow(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<CompositionWorkflow, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_composition_workflow(
    state: State<'_, Arc<AppState>>,
    input: CreateCompositionWorkflowInput,
) -> Result<CompositionWorkflow, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_composition_workflow(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateCompositionWorkflowInput,
) -> Result<CompositionWorkflow, AppError> {
    require_auth_sync(&state)?;
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_composition_workflow(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

/// Bulk import workflows from frontend localStorage migration.
/// Called once during the localStorage → SQLite migration.
#[tauri::command]
pub fn import_composition_workflows(
    state: State<'_, Arc<AppState>>,
    workflows: Vec<CompositionWorkflow>,
) -> Result<u32, AppError> {
    require_auth_sync(&state)?;
    repo::bulk_import(&state.db, workflows)
}
