use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreatePersonaMemoryInput, PersonaMemory};
use crate::db::repos::core::memories as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_memories(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    repo::get_all(&state.db, persona_id.as_deref(), category.as_deref(), limit, offset)
}

#[tauri::command]
pub fn create_memory(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaMemoryInput,
) -> Result<PersonaMemory, AppError> {
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn delete_memory(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}
