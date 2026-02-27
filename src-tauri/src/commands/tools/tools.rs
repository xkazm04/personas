use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreateToolDefinitionInput, PersonaTool, PersonaToolDefinition, UpdateToolDefinitionInput};
use crate::db::repos::execution::tool_usage;
use crate::db::repos::resources::tools as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_tool_definitions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaToolDefinition>, AppError> {
    repo::get_all_definitions(&state.db)
}

#[tauri::command]
pub fn get_tool_definition(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaToolDefinition, AppError> {
    repo::get_definition_by_id(&state.db, &id)
}

#[tauri::command]
pub fn get_tool_definitions_by_category(
    state: State<'_, Arc<AppState>>,
    category: String,
) -> Result<Vec<PersonaToolDefinition>, AppError> {
    repo::get_definitions_by_category(&state.db, &category)
}

#[tauri::command]
pub fn create_tool_definition(
    state: State<'_, Arc<AppState>>,
    input: CreateToolDefinitionInput,
) -> Result<PersonaToolDefinition, AppError> {
    repo::create_definition(&state.db, input)
}

#[tauri::command]
pub fn update_tool_definition(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateToolDefinitionInput,
) -> Result<PersonaToolDefinition, AppError> {
    repo::update_definition(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_tool_definition(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_definition(&state.db, &id)
}

#[tauri::command]
pub fn assign_tool(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    tool_id: String,
    tool_config: Option<String>,
) -> Result<PersonaTool, AppError> {
    repo::assign_tool(&state.db, &persona_id, &tool_id, tool_config)
}

#[tauri::command]
pub fn unassign_tool(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    tool_id: String,
) -> Result<bool, AppError> {
    repo::unassign_tool(&state.db, &persona_id, &tool_id)
}

#[tauri::command]
pub fn bulk_assign_tools(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    tool_ids: Vec<String>,
) -> Result<u32, AppError> {
    repo::bulk_assign_tools(&state.db, &persona_id, &tool_ids)
}

#[tauri::command]
pub fn bulk_unassign_tools(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    tool_ids: Vec<String>,
) -> Result<u32, AppError> {
    repo::bulk_unassign_tools(&state.db, &persona_id, &tool_ids)
}

#[tauri::command]
pub fn get_tool_usage_summary(
    state: State<'_, Arc<AppState>>,
    since: String,
    persona_id: Option<String>,
) -> Result<Vec<serde_json::Value>, AppError> {
    tool_usage::get_usage_summary(&state.db, &since, persona_id.as_deref())
}

#[tauri::command]
pub fn get_tool_usage_over_time(
    state: State<'_, Arc<AppState>>,
    since: String,
    persona_id: Option<String>,
) -> Result<Vec<serde_json::Value>, AppError> {
    tool_usage::get_usage_over_time(&state.db, &since, persona_id.as_deref())
}

#[tauri::command]
pub fn get_tool_usage_by_persona(
    state: State<'_, Arc<AppState>>,
    since: String,
) -> Result<Vec<serde_json::Value>, AppError> {
    tool_usage::get_usage_by_persona(&state.db, &since)
}
