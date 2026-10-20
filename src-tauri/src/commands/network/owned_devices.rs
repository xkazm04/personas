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
pub fn list_owned_devices(state: State<'_, Arc<AppState>>) -> Result<Vec<OwnedDevice>, AppError> {
    require_auth_sync(&state)?;
    owned_devices_repo::list_owned_devices(&state.db)
}

// `register_owned_device` was retired as an IPC: it wrote an owned_devices row
// (the sole input to remote-job trust) for any peer_id with no fingerprint
// ceremony and no public key, and had zero callers. Rows come from the pairing
// ceremony (`device_pairing.rs`); the repo fn stays for in-process callers.

/// Nominate (or un-nominate) a paired device as the user's home machine.
/// At most one device is home at a time — promoting one demotes the rest.
#[tauri::command]
pub fn set_device_home(
    state: State<'_, Arc<AppState>>,
    peer_id: String,
    is_home: bool,
) -> Result<OwnedDevice, AppError> {
    require_auth_sync(&state)?;
    owned_devices_repo::set_device_home(&state.db, peer_id.trim(), is_home)
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
