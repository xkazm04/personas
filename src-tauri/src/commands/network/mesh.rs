//! Tauri commands for the device mesh: every paired device's latest snapshot,
//! the closed verb set one device may run on another, moving a queued fleet
//! entry to another device, and the onboarding probe verdicts.
//!
//! Registered in EVERY build, with the bodies gated on `p2p` (golden path
//! `feature-flagged-compilation`): a build without `p2p` answers the reads with
//! an empty list and the writes with a typed "not in this build" error.
//!
//! Each body is one call. The pairing gate, the outbox and the liveness rule
//! live in the engine's remote-jobs/mesh modules; queue moves go through the
//! fleet's remote executor so there is ONE dispatch path.
//!
//! WP0 (contract freeze): these are stubs with the final signatures. The
//! bodies land in spark device-mesh WP2a.

use tauri::State;

use crate::db::models::{MeshDeviceView, MeshProbeVerdict, MeshVerbPayload, RemoteJob};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

fn not_ready(what: &str) -> AppError {
    AppError::Internal(format!(
        "{what}: the device mesh is not wired in this build yet."
    ))
}

/// Every device in the mesh, THIS device first (`isSelf`), then each paired
/// device with its reachability, last snapshot and liveness. A snapshot older
/// than `SNAPSHOT_STALE_AFTER_MS` reads `unknown`, never `live`.
#[tauri::command]
pub async fn mesh_device_snapshots(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<MeshDeviceView>, AppError> {
    require_auth(&state).await?;
    Ok(Vec::new())
}

/// Run one closed mesh verb on a paired device. Returns the persisted outbound
/// `mesh_verb` job: `pending`/`running` when the peer answered, `queued` when
/// it is offline, `refused` with the peer's reason otherwise. The outcome
/// arrives as a `MeshVerbReceipt` in the job's `receiptJson`.
#[tauri::command]
pub async fn mesh_send_verb(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
    payload: MeshVerbPayload,
) -> Result<RemoteJob, AppError> {
    require_auth(&state).await?;
    let _ = (peer_id, payload);
    Err(not_ready("mesh_send_verb"))
}

/// Move one QUEUED local fleet entry to a paired device: a `fleet_session` job
/// built from the entry goes out, and ONLY when the peer accepts it is the
/// local entry cancelled (reason `moved:<peer8>`). A refusal leaves the entry
/// where it was.
#[tauri::command]
pub async fn mesh_queue_move(
    state: State<'_, std::sync::Arc<AppState>>,
    session_id: String,
    peer_id: String,
) -> Result<RemoteJob, AppError> {
    require_auth(&state).await?;
    let _ = (session_id, peer_id);
    Err(not_ready("mesh_queue_move"))
}

/// Onboarding/probe verdicts recorded against one paired device, newest first.
#[tauri::command]
pub async fn mesh_probe_results(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<Vec<MeshProbeVerdict>, AppError> {
    require_auth(&state).await?;
    let _ = peer_id;
    Ok(Vec::new())
}
