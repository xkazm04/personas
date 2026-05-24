//! Tauri commands for the device-ownership registry (cross-device persona
//! continuity, ADR 2026-05-24 Stage 2). Thin wrappers over the ungated
//! `owned_devices` repo; the registry is the primitive a pairing flow writes
//! into (these commands, or the fleet `/friend` QR-pairing UI).

use std::sync::Arc;
use tauri::State;

use crate::db::models::OwnedDevice;
use crate::db::repos::resources::owned_devices as owned_devices_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Return this device's group id, generating and persisting one on first use.
#[tauri::command]
pub fn get_device_group_id(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    owned_devices_repo::ensure_device_group_id(&state.db)
}

/// List the user's own paired devices.
#[tauri::command]
pub fn list_owned_devices(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<OwnedDevice>, AppError> {
    require_auth_sync(&state)?;
    owned_devices_repo::list_owned_devices(&state.db)
}

/// Register a peer as one of the user's own devices.
#[tauri::command]
pub fn register_owned_device(
    state: State<'_, Arc<AppState>>,
    peer_id: String,
    device_group_id: String,
    display_name: String,
) -> Result<OwnedDevice, AppError> {
    require_auth_sync(&state)?;
    // Guard against pairing yourself as your own remote device.
    if let Some(local) = crate::db::repos::resources::identity::get_local_identity(&state.db)? {
        if local.peer_id == peer_id {
            return Err(AppError::Validation(
                "Cannot register this device as its own remote device".into(),
            ));
        }
    }
    owned_devices_repo::register_owned_device(
        &state.db,
        peer_id.trim(),
        device_group_id.trim(),
        display_name.trim(),
    )
}

/// Remove a device from the user's registry.
#[tauri::command]
pub fn forget_owned_device(
    state: State<'_, Arc<AppState>>,
    peer_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    owned_devices_repo::forget_owned_device(&state.db, &peer_id)
}
