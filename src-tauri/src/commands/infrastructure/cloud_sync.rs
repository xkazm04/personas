//! Tauri commands for the desktop → cloud sync writer, and for the paired
//! phones of the mobile command plane (`cloud::pairing` / `cloud::trust`).

use std::sync::Arc;

use personas_macros::requires;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::cloud::pairing::{self, PairingOutcome};
use crate::cloud::sync::client::SyncClient;
use crate::cloud::{sync, trust};
use crate::error::AppError;
use crate::AppState;

/// Enable or disable cloud sync (persisted; default off). Enabling kicks an
/// immediate pass via the loop's wake channel.
#[tauri::command]
#[requires(privileged)]
pub async fn cloud_sync_set_enabled(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), AppError> {
    sync::set_enabled(&state.db, enabled)
}

/// Read the current sync status (enabled flag + last-run telemetry).
#[tauri::command]
#[requires(privileged)]
pub async fn cloud_sync_status(
    state: State<'_, Arc<AppState>>,
) -> Result<sync::CloudSyncStatus, AppError> {
    Ok(sync::status(&state.db).await)
}

/// Trigger one sync pass now and return the fresh status (so the UI can render
/// the result without a follow-up round-trip). Requires a live Google-OAuth
/// session (cloud tier) since it pushes to Supabase. No-op if sync is disabled.
#[tauri::command]
#[requires(cloud)]
pub async fn cloud_sync_now(
    state: State<'_, Arc<AppState>>,
) -> Result<sync::CloudSyncStatus, AppError> {
    sync::run_sync_once(state.inner()).await;
    Ok(sync::status(&state.db).await)
}

/// Name this desktop in the cloud heartbeat (`synced_devices.name`), or clear
/// the name (`null` / blank) to send the platform label. Wakes the sync loop so
/// the phone sees it within one pass. Enforced by its `PRIVILEGED_COMMANDS`
/// entry (an async `#[requires(privileged)]` cannot fail; see below).
#[tauri::command]
pub async fn cloud_sync_set_device_name(
    state: State<'_, Arc<AppState>>,
    name: Option<String>,
) -> Result<sync::CloudSyncStatus, AppError> {
    sync::cursor::set_device_name(&state.db, name.as_deref())?;
    sync::notify_dirty();
    Ok(sync::status(&state.db).await)
}

/// Turn one per-class opt-in on or off: "Sync notes" (`notes`) or "Sync
/// chats" (`chats`). Both default off, also for users who already sync (owner
/// decision M19). Off deletes this device's rows of that class at the next
/// pass, which this wakes; returns the fresh status. Enforced by its
/// `PRIVILEGED_COMMANDS` entry, like the device name above.
#[tauri::command]
pub async fn cloud_sync_set_data_class(
    state: State<'_, Arc<AppState>>,
    class: sync::SyncDataClass,
    enabled: bool,
) -> Result<sync::CloudSyncStatus, AppError> {
    sync::set_data_class(&state.db, class, enabled)?;
    Ok(sync::status(&state.db).await)
}

// ── paired phones (mobile command plane, PHASE2-SPEC 3.2-3.4) ───────────

/// A started pairing, returned once to the Settings dialog. The secret lives
/// only inside `url` (in its fragment) and in desktop memory.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudPairingStart {
    pub pairing_id: String,
    /// `https://personas.so/dashboard/settings#pair=<pairing_id>.<secret>`.
    pub url: String,
    /// SVG document for the QR of `url`.
    pub qr_svg: String,
    /// Seconds until the secret is forgotten.
    pub expires_in_secs: u32,
}

/// Where a pairing stands.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CloudPairingState {
    Waiting,
    Paired,
    Expired,
    Refused,
}

/// One 2 s poll of a pairing.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudPairingPoll {
    pub state: CloudPairingState,
    /// The phone's display name, once paired.
    pub controller_name: Option<String>,
}

/// A paired phone, for the Settings list. Never carries key material.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudController {
    pub controller_id: String,
    pub name: String,
    pub created_at: String,
    pub revoked: bool,
    pub revoked_at: Option<String>,
}

async fn signed_in_client(state: &Arc<AppState>) -> Option<SyncClient> {
    let token = state
        .auth
        .read()
        .await
        .access_token
        .as_ref()
        .map(|t| t.expose_secret().to_string())?;
    SyncClient::new(token).ok()
}

/// Start pairing a phone: mint the in-memory secret and return the QR. Only
/// while cloud sync is on and the user is signed in - the phone reaches this
/// desktop through the same cloud plane.
#[tauri::command]
#[requires(cloud)]
pub async fn cloud_pair_controller_start(
    state: State<'_, Arc<AppState>>,
) -> Result<CloudPairingStart, AppError> {
    if !sync::cursor::is_enabled(&state.db) {
        return Err(AppError::Validation(
            "Turn on cloud sync before pairing a phone".into(),
        ));
    }
    if signed_in_client(state.inner()).await.is_none() {
        return Err(AppError::Auth("Not signed in".into()));
    }
    let ticket = pairing::begin_pairing(&state.db)?;
    let qr_svg = crate::commands::fleet::pairing::qr_svg(&ticket.url).map_err(|e| {
        pairing::end_pairing(&ticket.pairing_id);
        AppError::Internal(format!("pairing QR: {e}"))
    })?;
    Ok(CloudPairingStart {
        pairing_id: ticket.pairing_id,
        url: ticket.url,
        qr_svg,
        expires_in_secs: pairing::PAIRING_TTL.as_secs() as u32,
    })
}

/// One step of the ceremony; the dialog calls it every 2 s while the QR is up.
#[tauri::command]
#[requires(cloud)]
pub async fn cloud_pair_controller_poll(
    state: State<'_, Arc<AppState>>,
    pairing_id: String,
) -> Result<CloudPairingPoll, AppError> {
    let client = signed_in_client(state.inner())
        .await
        .ok_or_else(|| AppError::Auth("Not signed in".into()))?;
    let (state, controller_name) =
        match pairing::poll_pairing(&state.db, &client, &pairing_id).await? {
            PairingOutcome::Waiting => (CloudPairingState::Waiting, None),
            PairingOutcome::Paired(name) => (CloudPairingState::Paired, Some(name)),
            PairingOutcome::Expired => (CloudPairingState::Expired, None),
            PairingOutcome::Refused => (CloudPairingState::Refused, None),
        };
    Ok(CloudPairingPoll {
        state,
        controller_name,
    })
}

/// Forget a pairing's secret (the dialog closed before a phone paired).
///
/// The three paired-phone commands below carry no `#[requires(privileged)]`:
/// on an ASYNC command that attribute expands to a guard that cannot fail (the
/// census rule `unfalsifiable-tier-guard`). What enforces them is their entry
/// in `ipc_auth::PRIVILEGED_COMMANDS`, checked by the invoke wrapper.
#[tauri::command]
pub async fn cloud_pair_controller_cancel(pairing_id: String) -> Result<(), AppError> {
    pairing::end_pairing(&pairing_id);
    Ok(())
}

/// The paired phones, active first.
#[tauri::command]
pub async fn cloud_controllers_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CloudController>, AppError> {
    let mut list: Vec<CloudController> = trust::load_controllers(&state.db)
        .into_iter()
        .map(|c| CloudController {
            controller_id: c.controller_id,
            name: c.name,
            created_at: c.created_at,
            revoked: c.revoked,
            revoked_at: c.revoked_at,
        })
        .collect();
    list.sort_by_key(|c| c.revoked);
    Ok(list)
}

/// Revoke one paired phone, or every one (`controller_id` = null). The local
/// revoke is immediate and authoritative; the cloud row is updated when signed
/// in. Returns how many were newly revoked.
#[tauri::command]
pub async fn cloud_controller_revoke(
    state: State<'_, Arc<AppState>>,
    controller_id: Option<String>,
) -> Result<u32, AppError> {
    if let Some(id) = controller_id.as_deref() {
        uuid::Uuid::parse_str(id).map_err(|_| AppError::Validation("Invalid phone id".into()))?;
    }
    let client = signed_in_client(state.inner()).await;
    let n = trust::revoke(&state.db, client.as_ref(), controller_id.as_deref()).await?;
    Ok(n as u32)
}
