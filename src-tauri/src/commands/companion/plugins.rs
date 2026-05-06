//! Tauri commands for Athena's plugin toggles (dev_tools, future).

use std::sync::Arc;

use tauri::State;

use crate::companion::plugins::{self, PluginToggle};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

#[tauri::command]
pub fn companion_list_plugin_toggles(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PluginToggle>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    plugins::list(&state.user_db)
}

#[tauri::command]
pub fn companion_set_plugin_enabled(
    state: State<'_, Arc<AppState>>,
    plugin_name: String,
    enabled: bool,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    plugins::set_enabled(&state.user_db, &plugin_name, enabled)
}
