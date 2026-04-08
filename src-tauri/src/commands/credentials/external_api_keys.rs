//! Tauri commands for managing external API keys used by the management HTTP API.
//!
//! These keys authenticate non-IPC consumers (CLI, MCP servers, A2A clients).
//! All write commands are gated through `require_privileged_sync`.

use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreateApiKeyResponse, ExternalApiKey};
use crate::db::repos::resources::external_api_keys as repo;
use crate::error::AppError;
use crate::ipc_auth::require_privileged_sync;
use crate::AppState;

#[tauri::command]
pub fn create_external_api_key(
    state: State<'_, Arc<AppState>>,
    name: String,
    scopes: Vec<String>,
) -> Result<CreateApiKeyResponse, AppError> {
    require_privileged_sync(&state, "create_external_api_key")?;
    let resp = repo::create(&state.db, &name, scopes)?;
    tracing::info!(
        api_key_id = %resp.record.id,
        prefix = %resp.record.key_prefix,
        "external_api_key created"
    );
    Ok(resp)
}

#[tauri::command]
pub fn list_external_api_keys(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ExternalApiKey>, AppError> {
    repo::list(&state.db)
}

#[tauri::command]
pub fn revoke_external_api_key(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_privileged_sync(&state, "revoke_external_api_key")?;
    repo::revoke(&state.db, &id)?;
    tracing::info!(api_key_id = %id, "external_api_key revoked");
    Ok(())
}

#[tauri::command]
pub fn delete_external_api_key(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_privileged_sync(&state, "delete_external_api_key")?;
    repo::delete(&state.db, &id)?;
    tracing::info!(api_key_id = %id, "external_api_key deleted");
    Ok(())
}

/// Returns the bootstrap "system" API key — created on first call if missing —
/// so the desktop frontend can authenticate its direct HTTP fetches against the
/// management API. The plaintext is regenerated and persisted only on first
/// creation; subsequent calls return the in-memory cached plaintext for the
/// current process.
#[tauri::command]
pub fn get_system_api_key(
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    crate::engine::management_api::get_or_create_system_api_key(&state.db)
}
