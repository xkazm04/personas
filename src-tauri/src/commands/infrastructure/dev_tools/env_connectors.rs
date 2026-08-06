//! IPC surface for per-environment connector bindings.
//!
//! See `db::repos::dev_env_connectors` for why this is a table keyed by
//! `(project_id, dimension, env)` rather than more columns on `dev_projects`.
use std::sync::Arc;
use tauri::State;

use crate::db::models::DevProjectEnvConnector;
use crate::db::repos::dev_env_connectors as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn dev_tools_list_env_connectors(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevProjectEnvConnector>, AppError> {
    require_auth_sync(&state)?;
    repo::list_env_connectors(&state.db, &project_id)
}

/// Bind a credential to one (dimension, env) pair. Passing `credential_id:
/// None` CLEARS the pair — the UI's "unassign" is the same gesture as
/// "assign", so it is the same command.
#[tauri::command]
pub fn dev_tools_set_env_connector(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    dimension: String,
    env: String,
    credential_id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    match credential_id {
        Some(id) => repo::set_env_connector(&state.db, &project_id, &dimension, &env, &id),
        None => repo::clear_env_connector(&state.db, &project_id, &dimension, &env),
    }
}
