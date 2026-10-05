//! Server control IPC: start, stop and configure the dev servers of the
//! operator's dev projects. Thin adapters over `crate::webbuild::server_control`,
//! which owns the state table, the spawn rules and the scan.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::webbuild::server_control::{self, DevServerView};
use crate::AppState;

/// Every project in the view, sorted by workspace then name.
#[tauri::command]
pub async fn dev_servers_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DevServerView>, AppError> {
    require_auth_sync(&state)?;
    server_control::list(&state.db, &state.webbuild_servers).await
}

/// Start a project's dev server (usually returns it `starting`).
#[tauri::command]
pub async fn dev_server_start(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    server_control::start(&app, &state.db, &state.webbuild_servers, &project_id).await
}

/// Stop a project's dev server: ours, or the external owner of its port.
#[tauri::command]
pub async fn dev_server_stop(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    server_control::stop(&app, &state.db, &state.webbuild_servers, &project_id).await
}

#[tauri::command]
pub async fn dev_server_restart(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    server_control::restart(&app, &state.db, &state.webbuild_servers, &project_id).await
}

/// Set a project's dev command and port; auto-whitelists `http://localhost:<port>`.
#[tauri::command]
pub async fn dev_server_configure(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
    dev_command: Option<String>,
    dev_port: u16,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    server_control::configure(
        &app,
        &state.db,
        &state.webbuild_servers,
        &project_id,
        dev_command,
        dev_port,
    )
    .await
}

/// Take a project out of the view (never deletes it). Refused while live.
#[tauri::command]
pub async fn dev_server_remove(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    server_control::remove(&app, &state.db, &state.webbuild_servers, &project_id).await
}

/// Get-or-create the project for a folder, give it a free port, scan it.
#[tauri::command]
pub async fn dev_server_add_app(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    root_path: String,
    workspace_id: Option<String>,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    server_control::add_app(
        &app,
        &state.db,
        &state.webbuild_servers,
        &root_path,
        workspace_id,
    )
    .await
}

/// Re-run the repository scan (returns the row `scanning`).
#[tauri::command]
pub async fn dev_server_rescan(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
) -> Result<DevServerView, AppError> {
    require_auth_sync(&state)?;
    server_control::rescan(&app, &state.db, &state.webbuild_servers, &project_id).await
}
