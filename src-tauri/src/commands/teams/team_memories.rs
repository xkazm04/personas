use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreateTeamMemoryInput, TeamMemory, TeamMemoryStats};
use crate::db::repos::resources::team_memories as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_team_memories(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    run_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<TeamMemory>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(
        &state.db,
        &team_id,
        run_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
        limit,
        offset,
    )
}

#[tauri::command]
pub fn create_team_memory(
    state: State<'_, Arc<AppState>>,
    input: CreateTeamMemoryInput,
) -> Result<TeamMemory, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn delete_team_memory(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn update_team_memory(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    category: Option<String>,
    importance: Option<i32>,
) -> Result<TeamMemory, AppError> {
    require_auth_sync(&state)?;
    repo::update(
        &state.db,
        &id,
        title.as_deref(),
        content.as_deref(),
        category.as_deref(),
        importance,
    )
}

#[tauri::command]
pub fn update_team_memory_importance(
    state: State<'_, Arc<AppState>>,
    id: String,
    importance: i32,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::update_importance(&state.db, &id, importance)
}

#[tauri::command]
pub fn batch_delete_team_memories(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::batch_delete(&state.db, &ids)
}

#[tauri::command]
pub fn get_team_memory_count(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    run_id: Option<String>,
    category: Option<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::get_total_count(&state.db, &team_id, run_id.as_deref(), category.as_deref())
}

#[tauri::command]
pub fn get_team_memory_stats(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    category: Option<String>,
    search: Option<String>,
) -> Result<TeamMemoryStats, AppError> {
    require_auth_sync(&state)?;
    repo::get_stats(&state.db, &team_id, category.as_deref(), search.as_deref())
}

#[tauri::command]
pub fn list_team_memories_by_run(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<TeamMemory>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_run(&state.db, &run_id)
}
