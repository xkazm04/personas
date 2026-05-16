use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    ConnectorDefinition, CreateConnectorDefinitionInput, UpdateConnectorDefinitionInput,
};
use crate::db::repos::resources::connectors as repo;
use crate::engine::api_proxy::{invalidate_connector_cache, refresh_connector_keyword_snapshot};
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

#[tauri::command]
pub fn list_connectors(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConnectorDefinition>, AppError> {
    // Public command — no IPC token required (read-only, needed at startup)
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
#[requires(privileged)]
pub fn create_connector(
    state: State<'_, Arc<AppState>>,
    input: CreateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    let result = repo::create(&state.db, input)?;
    invalidate_connector_cache();
    refresh_connector_keyword_snapshot(&state.db);
    Ok(result)
}

#[tauri::command]
#[requires(privileged)]
pub fn update_connector(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    let result = repo::update(&state.db, &id, input)?;
    invalidate_connector_cache();
    refresh_connector_keyword_snapshot(&state.db);
    Ok(result)
}

#[tauri::command]
#[requires(privileged)]
pub fn delete_connector(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    let result = repo::delete(&state.db, &id)?;
    invalidate_connector_cache();
    refresh_connector_keyword_snapshot(&state.db);
    Ok(result)
}
