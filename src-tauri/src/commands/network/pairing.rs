//! Tauri commands for the device-pairing ceremony.
//!
//! Thin wrappers over `engine::p2p::device_pairing::DevicePairing`. The
//! ceremony itself (fingerprint derivation, wire exchange, who writes which
//! `owned_devices` row) is documented on that module; these commands only
//! translate IPC calls into it.

use tauri::State;

use crate::db::models::OwnedDevice;
use crate::engine::p2p::device_pairing::DevicePairingRequest;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

fn pairing(
    state: &AppState,
) -> Result<&std::sync::Arc<crate::engine::p2p::device_pairing::DevicePairing>, AppError> {
    state
        .network
        .as_ref()
        .map(|net| &net.pairing)
        .ok_or_else(|| AppError::Internal("Network service not initialized".into()))
}

/// Ask an already-connected peer to pair. Returns the fingerprint to display;
/// the same six digits appear on the other device.
#[tauri::command]
pub async fn pair_request(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<DevicePairingRequest, AppError> {
    require_auth(&state).await?;
    pairing(&state)?.request(&peer_id).await
}

/// Confirm a pairing after the user compared fingerprints. Only valid on the
/// *receiving* device; writes the `owned_devices` row here and instructs the
/// initiator to write its mirror.
#[tauri::command]
pub async fn pair_confirm(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<OwnedDevice, AppError> {
    require_auth(&state).await?;
    pairing(&state)?.confirm(&peer_id).await
}

/// Abandon a pairing from either side. Idempotent — cancelling an unknown
/// pairing succeeds, so a double-click cannot produce a spurious error.
#[tauri::command]
pub async fn pair_cancel(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    pairing(&state)?.cancel(&peer_id).await
}

/// Pairings awaiting a decision on this device. A poll-based safety net for a
/// UI that missed the `network:device-pairing-requested` event.
#[tauri::command]
pub async fn list_pending_device_pairings(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<DevicePairingRequest>, AppError> {
    require_auth(&state).await?;
    Ok(pairing(&state)?.list_pending().await)
}
