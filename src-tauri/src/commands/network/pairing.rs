//! Tauri commands for the device-pairing ceremony.
//!
//! Thin wrappers over `engine::p2p::device_pairing::DevicePairing`. The
//! ceremony itself (fingerprint derivation, wire exchange, who writes which
//! `owned_devices` row) is documented on that module; these commands only
//! translate IPC calls into it.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::OwnedDevice;
use crate::engine::p2p::device_pairing::{DevicePairingRequest, PairCodeError};
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

/// What [`pair_confirm_code`] tells the UI after the human typed a code.
///
/// The two expected refusals (a wrong code, nothing pending) are VERDICTS,
/// not errors: the form branches on `kind` and shows the attempts left,
/// instead of matching message text. Only a failure of the confirm path
/// itself, after the code matched, is an `AppError`. The expected code is
/// never in here.
///
/// Lives beside the command rather than in the engine: it is the IPC
/// projection of `PairCodeError` (the HTTP door has its own, `DoorError`),
/// so its reach is this file.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PairCodeVerdict {
    /// The code matched; this device wrote its `owned_devices` row.
    Paired { device: OwnedDevice },
    /// The code did not match. `withdrawn` means that was the last allowed
    /// attempt and the ceremony was cancelled (start again for a new code).
    Mismatch { attempts_left: u32, withdrawn: bool },
    /// No pairing request from that peer is waiting for this device.
    NoPending,
}

/// Map the engine's typed-code outcome onto the IPC verdict. Pure, so every
/// arm is testable without an `AppState`.
fn verdict_from(r: Result<OwnedDevice, PairCodeError>) -> Result<PairCodeVerdict, AppError> {
    match r {
        Ok(device) => Ok(PairCodeVerdict::Paired { device }),
        Err(PairCodeError::Mismatch {
            attempts_left,
            withdrawn,
        }) => Ok(PairCodeVerdict::Mismatch {
            attempts_left,
            withdrawn,
        }),
        Err(PairCodeError::NoPending) => Ok(PairCodeVerdict::NoPending),
        Err(PairCodeError::Confirm(e)) => Err(e),
    }
}

/// Confirm a pairing by TYPING the six digits the initiating device shows.
/// Only valid on the *receiving* device. The engine normalises the spelling,
/// compares in constant time, delays every failure and withdraws the pairing
/// after the last allowed miss; a match runs the same path as
/// [`pair_confirm`].
#[tauri::command]
pub async fn pair_confirm_code(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
    code: String,
) -> Result<PairCodeVerdict, AppError> {
    require_auth(&state).await?;
    verdict_from(pairing(&state)?.confirm_with_code(&peer_id, &code).await)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> OwnedDevice {
        OwnedDevice {
            peer_id: "peer-b".into(),
            device_group_id: "group-1".into(),
            display_name: "Desk PC".into(),
            added_at: "2026-11-05T00:00:00Z".into(),
            last_synced_at: None,
            is_home: false,
            paired_at: Some("2026-11-05T00:00:00Z".into()),
            public_key: None,
        }
    }

    #[test]
    fn verdict_paired_carries_the_device() {
        match verdict_from(Ok(device())) {
            Ok(PairCodeVerdict::Paired { device }) => assert_eq!(device.peer_id, "peer-b"),
            other => panic!("expected Paired, got {other:?}"),
        }
    }

    #[test]
    fn verdict_mismatch_keeps_attempts_and_withdrawn() {
        let v = verdict_from(Err(PairCodeError::Mismatch {
            attempts_left: 0,
            withdrawn: true,
        }))
        .unwrap();
        assert!(matches!(
            v,
            PairCodeVerdict::Mismatch {
                attempts_left: 0,
                withdrawn: true
            }
        ));
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "mismatch", "attemptsLeft": 0, "withdrawn": true })
        );
    }

    #[test]
    fn verdict_no_pending_is_not_an_error() {
        let v = verdict_from(Err(PairCodeError::NoPending)).unwrap();
        assert!(matches!(v, PairCodeVerdict::NoPending));
        assert_eq!(
            serde_json::to_value(&v).unwrap(),
            serde_json::json!({ "kind": "noPending" })
        );
    }

    #[test]
    fn verdict_confirm_failure_is_the_app_error() {
        match verdict_from(Err(PairCodeError::Confirm(AppError::NotFound(
            "gone".into(),
        )))) {
            Err(AppError::NotFound(m)) => assert_eq!(m, "gone"),
            other => panic!("expected Err(NotFound), got {other:?}"),
        }
    }
}
