//! Tauri commands for Athena's pinned connectors (Phase F).
//!
//! Surface:
//!   - `companion_list_active_connectors` — drives the sidebar render.
//!   - `companion_set_active_connectors` — picker-modal apply path.
//!   - `companion_set_connector_enabled` — toggle on/off in place.
//!   - `companion_remove_connector` — right-click → remove.

use std::sync::Arc;

use tauri::State;

use crate::companion::connectors::{self, ActiveConnector};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

#[tauri::command]
pub fn companion_list_active_connectors(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ActiveConnector>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    connectors::list(&state.user_db)
}

/// Replace the entire pinned set with `connector_names` (used by the
/// picker modal's "apply" button). Names already pinned keep their
/// enabled state; new names default to enabled=true; missing names
/// are removed.
#[tauri::command]
pub fn companion_set_active_connectors(
    state: State<'_, Arc<AppState>>,
    connector_names: Vec<String>,
) -> Result<Vec<ActiveConnector>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    connectors::replace_all(&state.user_db, &connector_names)?;
    connectors::list(&state.user_db)
}

#[tauri::command]
pub fn companion_set_connector_enabled(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
    enabled: bool,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    connectors::set_enabled(&state.user_db, &connector_name, enabled)
}

#[tauri::command]
pub fn companion_remove_connector(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    connectors::remove(&state.user_db, &connector_name)
}
