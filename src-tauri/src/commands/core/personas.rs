use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreatePersonaInput, Persona, PersonaSummary, UpdatePersonaInput};
use crate::db::repos::core::personas as repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_personas(state: State<'_, Arc<AppState>>) -> Result<Vec<Persona>, AppError> {
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<Persona, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_persona(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaInput,
) -> Result<Persona, AppError> {
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_persona(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdatePersonaInput,
) -> Result<Persona, AppError> {
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn get_persona_summaries(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaSummary>, AppError> {
    repo::get_summaries(&state.db)
}

#[tauri::command]
pub async fn delete_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    // Cancel any running/queued executions for this persona before deleting
    if let Ok(running) = exec_repo::get_running(&state.db) {
        for exec in running {
            if exec.persona_id == id {
                state
                    .engine
                    .cancel_execution(&exec.id, &state.db, Some(&id))
                    .await;
            }
        }
    }

    repo::delete(&state.db, &id)
}
