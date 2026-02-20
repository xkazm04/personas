use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    ConnectorDefinition, CreateConnectorDefinitionInput, UpdateConnectorDefinitionInput,
};
use crate::db::repos::resources::connectors as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_connectors(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConnectorDefinition>, AppError> {
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_connector(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ConnectorDefinition, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_connector(
    state: State<'_, Arc<AppState>>,
    input: CreateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_connector(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_connector(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}
