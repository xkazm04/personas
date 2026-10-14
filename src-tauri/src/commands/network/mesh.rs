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
//! fleet's remote executor so there is ONE dispatch path (`crate::mesh`).

use tauri::{AppHandle, State};

use crate::db::models::{MeshDeviceView, MeshProbeVerdict, MeshVerbPayload, RemoteJob};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[cfg(feature = "p2p")]
fn network(
    state: &AppState,
) -> Result<&std::sync::Arc<crate::engine::p2p::NetworkService>, AppError> {
    state.network.as_ref().ok_or_else(|| {
        AppError::NetworkOffline(
            "The device link is not running on this device yet. Try again in a moment.".into(),
        )
    })
}

#[cfg(not(feature = "p2p"))]
fn not_in_build(what: &str) -> AppError {
    AppError::Validation(format!("{what}: this build has no device mesh (p2p)."))
}

/// Every device in the mesh, THIS device first (`isSelf`), then each paired
/// device with its reachability, last snapshot and liveness. A snapshot older
/// than `SNAPSHOT_STALE_AFTER_MS` reads `unknown`, never `live`. Empty while
/// the device link is not up.
#[tauri::command]
pub async fn mesh_device_snapshots(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<MeshDeviceView>, AppError> {
    require_auth(&state).await?;
    #[cfg(feature = "p2p")]
    {
        match state.network.as_ref() {
            Some(net) => net.mesh_device_snapshots().await,
            None => Ok(Vec::new()),
        }
    }
    #[cfg(not(feature = "p2p"))]
    {
        Ok(Vec::new())
    }
}

/// Run one closed mesh verb on a paired device. Returns the persisted outbound
/// `mesh_verb` job: `pending`/`running` when the peer answered, `queued` when
/// it is offline, `refused` with the peer's reason otherwise. The outcome
/// arrives as the job's `meshReceipt`.
#[tauri::command]
pub async fn mesh_send_verb(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
    payload: MeshVerbPayload,
) -> Result<RemoteJob, AppError> {
    require_auth(&state).await?;
    #[cfg(feature = "p2p")]
    {
        network(&state)?
            .remote_jobs
            .send_mesh_verb(peer_id.trim(), &payload)
            .await
    }
    #[cfg(not(feature = "p2p"))]
    {
        let _ = (peer_id, payload);
        Err(not_in_build("mesh_send_verb"))
    }
}

/// Move one QUEUED local fleet entry to a paired device: a `fleet_session` job
/// built from the entry goes out, and ONLY when the peer accepts it is the
/// local entry cancelled (reason `moved:<peer8>`). A refusal leaves the entry
/// where it was; an offline peer is `NetworkOffline` with no job created.
#[tauri::command]
pub async fn mesh_queue_move(
    app: AppHandle,
    state: State<'_, std::sync::Arc<AppState>>,
    session_id: String,
    peer_id: String,
) -> Result<RemoteJob, AppError> {
    require_auth(&state).await?;
    #[cfg(feature = "p2p")]
    {
        let ports = crate::mesh::queue_move::AppPorts {
            app,
            state: state.inner().clone(),
        };
        crate::mesh::queue_move::move_queued(&ports, &session_id, &peer_id).await
    }
    #[cfg(not(feature = "p2p"))]
    {
        let _ = (app, session_id, peer_id);
        Err(not_in_build("mesh_queue_move"))
    }
}

/// Onboarding/probe verdicts recorded against one paired device, newest first.
/// A pure DB read: it works with the link down.
#[tauri::command]
pub async fn mesh_probe_results(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<Vec<MeshProbeVerdict>, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let joined = tokio::task::spawn_blocking(move || {
        crate::db::repos::resources::mesh_probes::list_for_peer(&db, peer_id.trim(), None)
    })
    .await;
    joined.map_err(|e| AppError::Internal(format!("mesh_probe_results join: {e}")))?
}
