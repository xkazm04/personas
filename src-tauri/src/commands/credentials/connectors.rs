use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    ConnectorDefinition, CreateConnectorDefinitionInput, UpdateConnectorDefinitionInput,
};
use crate::db::repos::resources::connectors as repo;
use crate::engine::api_proxy::invalidate_connector_cache;
use crate::error::AppError;
use crate::ipc_auth::require_privileged_sync;
use crate::AppState;

#[tauri::command]
pub fn list_connectors(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConnectorDefinition>, AppError> {
    require_privileged_sync(&state, "list_connectors")?;
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_connector(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ConnectorDefinition, AppError> {
    require_privileged_sync(&state, "get_connector")?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_connector(
    state: State<'_, Arc<AppState>>,
    input: CreateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    require_privileged_sync(&state, "create_connector")?;
    let result = repo::create(&state.db, input)?;
    invalidate_connector_cache();
    Ok(result)
}

#[tauri::command]
pub fn update_connector(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    require_privileged_sync(&state, "update_connector")?;
    let result = repo::update(&state.db, &id, input)?;
    invalidate_connector_cache();
    Ok(result)
}

#[tauri::command]
pub fn delete_connector(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_privileged_sync(&state, "delete_connector")?;
    let result = repo::delete(&state.db, &id)?;
    invalidate_connector_cache();
    Ok(result)
}
