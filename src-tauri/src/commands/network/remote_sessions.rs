//! Tauri commands for dispatching a fleet session to another paired device and
//! tracking it from this one.
//!
//! Registered in EVERY build, with the bodies gated on `p2p` (golden path
//! `feature-flagged-compilation`): a lite build answers the two reads with an
//! empty list and the three writes with a typed "not in this build" error,
//! instead of rejecting with `Command "x" not found`.
//!
//! Each body is one call. Every decision - the pairing gate, the offline
//! outbox, the liveness rule that turns a quiet session into `unknown` - lives
//! in the engine's remote-jobs module; the branch minting and the one dispatch
//! path live in the fleet's remote executor (`commands::fleet::remote_exec`),
//! which Athena's `remote_fleet_dispatch` op calls too.

use tauri::State;

use crate::db::models::{
    DispatchDevice, FleetSessionJobPayload, RemoteJob, RemoteSessionCommand, RemoteSessionView,
};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// The `p2p` cargo feature is off in this build - a capability gap, not a user
/// input problem, so it maps to `Internal` rather than `Validation`.
#[cfg(not(feature = "p2p"))]
fn not_enabled() -> AppError {
    AppError::Internal("Device-to-device dispatch is not enabled in this build.".into())
}

/// The running network service's job lane, or the typed "not up yet" error.
#[cfg(feature = "p2p")]
fn jobs(
    state: &AppState,
) -> Result<&std::sync::Arc<crate::engine::p2p::remote_jobs::RemoteJobs>, AppError> {
    state
        .network
        .as_ref()
        .map(|net| &net.remote_jobs)
        .ok_or_else(|| {
            AppError::NetworkOffline(
                "remote_peer_offline: the device link is not running yet. Try again in a moment."
                    .into(),
            )
        })
}

/// Send one fleet session to a paired device. Returns the persisted outbound
/// job: `pending`/`running` when the peer answered, `queued` when it is offline
/// (the job waits in this device's outbox and goes out on the next link-up),
/// or `refused` with the peer's reason (e.g. `project_not_found`).
///
/// The branch is minted HERE, never taken from the caller: the frontend sends
/// `branch: ""` on purpose.
#[tauri::command]
pub async fn dispatch_remote_fleet_session(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
    payload: FleetSessionJobPayload,
) -> Result<RemoteJob, AppError> {
    require_auth(&state).await?;
    #[cfg(feature = "p2p")]
    {
        crate::commands::fleet::remote_exec::dispatch(&state, &peer_id, payload).await
    }
    #[cfg(not(feature = "p2p"))]
    {
        let _ = (peer_id, payload);
        Err(not_enabled())
    }
}

/// The remote sessions this device dispatched: every outbound `fleet_session`
/// job that is non-terminal, or terminal within the last hour. A DB read, so it
/// works with the network stopped; liveness is applied on read (a running
/// session with no mirror for 45 s reads `unknown`).
#[tauri::command]
pub fn list_remote_sessions(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<RemoteSessionView>, AppError> {
    require_auth_sync(&state)?;
    #[cfg(feature = "p2p")]
    {
        use crate::engine::p2p::remote_sessions;
        remote_sessions::list_views(&state.db, remote_sessions::now_ms())
    }
    #[cfg(not(feature = "p2p"))]
    {
        Ok(Vec::new())
    }
}

/// Steer a running remote session: `send_input` (with `text`), `kill`, `wake`.
/// Resolves when the running device acknowledged the command; fails typed when
/// the peer is unreachable or refused it.
#[tauri::command]
pub async fn remote_session_command(
    state: State<'_, std::sync::Arc<AppState>>,
    job_id: String,
    command: RemoteSessionCommand,
    text: Option<String>,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    #[cfg(feature = "p2p")]
    {
        jobs(&state)?
            .send_command(job_id.trim(), command, text)
            .await
    }
    #[cfg(not(feature = "p2p"))]
    {
        let _ = (job_id, command, text);
        Err(not_enabled())
    }
}

/// Start or stop the lossy output tail for one remote session. Closing a viewer
/// unsubscribes; it never cancels the session.
#[tauri::command]
pub async fn remote_session_subscribe_output(
    state: State<'_, std::sync::Arc<AppState>>,
    job_id: String,
    subscribe: bool,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    #[cfg(feature = "p2p")]
    {
        jobs(&state)?
            .subscribe_output(job_id.trim(), subscribe)
            .await
    }
    #[cfg(not(feature = "p2p"))]
    {
        let _ = (job_id, subscribe);
        Err(not_enabled())
    }
}

/// The paired devices as dispatch targets, with their reachability right now.
/// Excludes this device. Empty in a build without `p2p`, and while the network
/// service has not started.
#[tauri::command]
pub async fn list_dispatch_devices(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<DispatchDevice>, AppError> {
    require_auth(&state).await?;
    #[cfg(feature = "p2p")]
    {
        match state.network.as_ref() {
            Some(net) => net.dispatch_devices().await,
            None => Ok(Vec::new()),
        }
    }
    #[cfg(not(feature = "p2p"))]
    {
        Ok(Vec::new())
    }
}
