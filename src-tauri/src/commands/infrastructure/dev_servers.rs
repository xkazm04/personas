//! Server control IPC: start, stop and configure the dev servers of the
//! operator's dev projects. See `crate::webbuild::server_control`.
//!
//! WP0 STUBS: signatures are frozen by the spark contract; WP1 fills the bodies.

use std::sync::Arc;

use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::webbuild::server_control::DevServerView;
use crate::AppState;

fn not_yet() -> AppError {
    AppError::Internal("server control: not implemented yet".into())
}

#[tauri::command]
pub async fn dev_servers_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DevServerView>, AppError> {
    require_auth_sync(&state)?;
    Err(not_yet())
}

#[tauri::command]
pub async fn dev_server_start(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    let _ = project_id;
    Err(not_yet())
}

#[tauri::command]
pub async fn dev_server_stop(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    let _ = project_id;
    Err(not_yet())
}

#[tauri::command]
pub async fn dev_server_restart(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    let _ = project_id;
    Err(not_yet())
}

#[tauri::command]
pub async fn dev_server_configure(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    dev_command: Option<String>,
    dev_port: u16,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    let _ = (project_id, dev_command, dev_port);
    Err(not_yet())
}

#[tauri::command]
pub async fn dev_server_remove(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let _ = project_id;
    Err(not_yet())
}

#[tauri::command]
pub async fn dev_server_add_app(
    state: State<'_, Arc<AppState>>,
    root_path: String,
    workspace_id: Option<String>,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    let _ = (root_path, workspace_id);
    Err(not_yet())
}

#[tauri::command]
pub async fn dev_server_rescan(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    let _ = project_id;
    Err(not_yet())
}
