//! The device mesh's app-layer half (spark device-mesh, WP2a).
//!
//! The engine (`engine::p2p::{mesh, remote_jobs}`) owns the wire, the pairing
//! gate, the outbox and the liveness rule. It cannot see the fleet registry,
//! the personas or the host metrics, so everything that reads THIS device's
//! state, or acts on it for a paired device, lives here:
//!
//! - [`snapshot`]: the `DeviceSnapshotProvider` that builds this device's
//!   `DeviceSnapshot` (host load, running/queued counts, the queue, every
//!   persona with its project switch and dominant resource axis).
//! - [`verbs`]: the `mesh_verb` executor. Each verb goes through the SAME
//!   door its local twin uses (`cloud::remote_commands::apply_enabled`,
//!   `dev_projects::set_enabled`, the `fleet_queue_*` commands), so a remote
//!   switch cannot behave differently from a local one.
//! - [`queue_move`]: moving a QUEUED local fleet entry to a paired device,
//!   cancel-after-accept (decision D3), through the one remote dispatch path.
//!
//! [`install`] wires both seams at boot, BEFORE the network starts, next to
//! `companion::remote_jobs::install` (which routes `mesh_verb` jobs to
//! [`verbs::execute`]).

pub mod queue_move;
pub mod snapshot;
pub mod verbs;

use std::sync::Arc;

use tauri::{AppHandle, Listener};

use crate::engine::event_registry::event_name;
use crate::engine::p2p::NetworkService;

/// Install the snapshot provider and the change hooks. Called once at boot,
/// before `NetworkService::start`.
///
/// **Change hooks** (each one a debounced re-send, never a send per event):
/// - `fleet-queue-changed`: an entry was queued, reordered, started,
///   cancelled or expired;
/// - `fleet-session-state`: a fleet session changed state (the narrowest
///   existing signal for "running" moving);
/// - a persona or project switch flipped BY A MESH VERB ([`verbs`] calls
///   [`NetworkService::mesh`]`.note_changed()` itself).
///
/// A persona switched in THIS device's own UI emits no event today
/// (`personas::set_enabled` is a bare repo write), so it reaches peers on the
/// next 15 s health tick instead of within 2 s.
pub async fn install(app: &AppHandle, network: &Arc<NetworkService>) {
    network
        .mesh
        .set_provider(Arc::new(snapshot::AppSnapshotProvider::new(app.clone())))
        .await;
    for event in [
        event_name::FLEET_QUEUE_CHANGED,
        event_name::FLEET_SESSION_STATE,
    ] {
        let mesh = network.mesh.clone();
        app.listen(event, move |_| mesh.note_changed());
    }
}

/// Up to eight lowercase alphanumerics of a peer id, as `moved:<peer8>`
/// carries it.
pub fn peer8(peer_id: &str) -> String {
    peer_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase()
}
