//! Tauri commands for cross-device instruction dispatch.
//!
//! Thin wrappers over `engine::p2p::remote_jobs::RemoteJobs` (the wire and the
//! state machine) and the ungated `remote_jobs` repo (reads). Everything that
//! decides anything — the pairing gate, the typed offline refusal, the
//! exactly-once replay — lives in those two modules; nothing here is a policy
//! decision, so there is no second place for the trust check to drift to.

use tauri::State;

use crate::db::models::{RemoteJob, RemoteJobDirection, RemoteJobNote};
use crate::db::repos::resources::remote_jobs as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

fn jobs(
    state: &AppState,
) -> Result<&std::sync::Arc<crate::engine::p2p::remote_jobs::RemoteJobs>, AppError> {
    state
        .network
        .as_ref()
        .map(|net| &net.remote_jobs)
        .ok_or_else(|| AppError::Internal("Network service not initialized".into()))
}

/// The remote-job history, newest first. `direction` narrows to `"outbound"`
/// (work this device sent) or `"inbound"` (work it was asked to do); omit it for
/// both, which is how the combined timeline is read.
///
/// A pure DB read, so it works in a build with the network stopped — a user must
/// be able to look at what happened yesterday without the link being up.
#[tauri::command]
pub fn list_remote_jobs(
    state: State<'_, std::sync::Arc<AppState>>,
    direction: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<RemoteJob>, AppError> {
    require_auth_sync(&state)?;
    let direction = match direction.as_deref() {
        None | Some("") | Some("all") => None,
        Some(d) => Some(RemoteJobDirection::parse(d).ok_or_else(|| {
            AppError::Validation(format!(
                "Unknown remote job direction '{d}' (expected 'outbound' or 'inbound')"
            ))
        })?),
    };
    repo::list(&state.db, direction, limit.unwrap_or(100))
}

/// One job's progress notes, oldest first — the transcript under a job row.
#[tauri::command]
pub fn list_remote_job_notes(
    state: State<'_, std::sync::Arc<AppState>>,
    job_id: String,
) -> Result<Vec<RemoteJobNote>, AppError> {
    require_auth_sync(&state)?;
    repo::list_notes(&state.db, job_id.trim())
}

/// Send a natural-language instruction to one of this user's paired devices and
/// wait for its acknowledgement.
///
/// Returns the persisted job once the peer has answered, so the caller can show
/// "running" or the refusal reason without a second round trip. Fails typed and
/// early when the device is not paired (`forbidden`) or not currently reachable
/// (`network_offline`, naming the device and the remedy) — neither leaves a row.
#[tauri::command]
pub async fn send_remote_instruction(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
    instruction: String,
    kind: Option<String>,
) -> Result<RemoteJob, AppError> {
    require_auth(&state).await?;
    jobs(&state)?
        .send_instruction(peer_id.trim(), kind, &instruction)
        .await
}
