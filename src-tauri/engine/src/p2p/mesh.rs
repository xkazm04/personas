//! The device mesh's LATEST-WINS half: what each paired device last said about
//! itself ([`DeviceSnapshot`]), how believable that still is, and sending this
//! device's own (spark device-mesh, decision D2).
//!
//! ```text
//!  this device                                   each CONNECTED paired peer
//!  provider.build()  (app layer, installed at boot)
//!    every health tick (15 s), on link-up,
//!    and on change (debounced CHANGE_DEBOUNCE)
//!    ── DeviceSnapshot{json} ──────────────────────────▶ handle_message
//!                                                        pairing gate (RemoteJobs)
//!                                                        peer_id == sender? else refuse
//!                                                        cache[sender] = (snapshot, now)
//!                                                        emit network:device-snapshot
//! ```
//!
//! ## What it deliberately is not
//!
//! - **Not persisted.** The cache is memory only; a restart begins every peer
//!   at `unknown` until its next snapshot lands, which is the truth.
//! - **Not replayed.** A snapshot that missed its link is simply superseded by
//!   the next one. There is no numbering and no outbox.
//! - **Not broadcast.** It goes only to `owned_devices` rows with a live
//!   authenticated connection, never to a stranger and never over mDNS
//!   (discovery still advertises nothing but id, name and protocol version).
//!
//! ## Liveness
//!
//! A view is `live` while its snapshot is younger than
//! [`SNAPSHOT_STALE_AFTER_MS`] by THIS device's clock (`received_at_ms`, never
//! the sender's `sent_at_ms`, so a skewed peer clock cannot keep a dead device
//! looking alive). [`Mesh::expire_stale`] runs on the health tick and reports
//! each live -> unknown transition exactly once, so the UI hears about it
//! without being told every tick.
//!
//! ## The seam
//!
//! [`DeviceSnapshotProvider`] is installed by the app layer at boot, BEFORE the
//! network starts (the same pattern as `RemoteJobExecutor`). Until then this
//! device simply sends nothing. The engine stamps the identity fields
//! (`peer_id`, `display_name`, `sent_at_ms`) itself, so a provider cannot
//! claim to be another device.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Notify, RwLock};
use tokio_util::sync::CancellationToken;

use personas_core::error::AppError;
use personas_db::models::{
    DeviceReachability, DeviceSnapshot, MeshDeviceView, MeshLiveness, SNAPSHOT_STALE_AFTER_MS,
};
use personas_db::repos::resources::mesh_probes;
use personas_db::repos::resources::owned_devices as owned_devices_repo;
use personas_db::DbPool;

use super::connection::ConnectionManager;
use super::protocol::{self, Message};
use crate::event_registry::{emit_event, event_name};

/// How long a burst of changes is collected before one snapshot goes out.
pub const CHANGE_DEBOUNCE: Duration = Duration::from_secs(2);

/// Hard cap on one snapshot's JSON, either direction. A roster of a few
/// hundred personas and a full queue is well under 100 KB.
pub const MAX_SNAPSHOT_BYTES: usize = 512 * 1024;

/// Builds THIS device's snapshot. Implemented in the app layer (which can see
/// the fleet registry, the personas and the host metrics) and installed with
/// [`Mesh::set_provider`].
///
/// `build` must be quick (reads, not work): it runs on every health tick and
/// on every debounced change. Whatever it puts in `peer_id`, `display_name`
/// and `sent_at_ms` is overwritten by the engine.
#[async_trait::async_trait]
pub trait DeviceSnapshotProvider: Send + Sync {
    async fn build(&self) -> Result<DeviceSnapshot, AppError>;
}

/// One peer's latest snapshot as this device holds it.
#[derive(Debug, Clone)]
struct Cached {
    snapshot: DeviceSnapshot,
    /// When it landed HERE (this device's clock).
    received_at_ms: f64,
    /// Whether the last view announced for this peer was `live`. Makes the
    /// live -> unknown transition fire once.
    announced_live: bool,
}

/// `live` while `received_at_ms` is within the stale window of `now_ms`.
pub fn liveness_at(received_at_ms: Option<f64>, now_ms: f64) -> MeshLiveness {
    match received_at_ms {
        Some(at) if now_ms - at <= SNAPSHOT_STALE_AFTER_MS => MeshLiveness::Live,
        _ => MeshLiveness::Unknown,
    }
}

/// Wall-clock milliseconds since the epoch.
pub fn now_ms() -> f64 {
    chrono::Utc::now().timestamp_millis() as f64
}

/// The device mesh's snapshot cache and sender. Owned by `RemoteJobs` (whose
/// `handle_message` is the pairing gate every inbound snapshot passes) and
/// shared with `NetworkService`.
pub struct Mesh {
    pool: DbPool,
    connections: Arc<ConnectionManager>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    provider: RwLock<Option<Arc<dyn DeviceSnapshotProvider>>>,
    /// Latest-wins, memory only. A std mutex: never held across an await.
    cache: std::sync::Mutex<HashMap<String, Cached>>,
    /// Set by [`Self::note_changed`], cleared by the debounce loop when it
    /// sends, so a burst of changes costs one snapshot.
    dirty: AtomicBool,
    changed: Notify,
    /// Every event this module would have emitted, for tests without an
    /// `AppHandle`.
    #[cfg(test)]
    pub(crate) emitted: std::sync::Mutex<Vec<(&'static str, serde_json::Value)>>,
}

impl Mesh {
    pub fn new(
        pool: DbPool,
        connections: Arc<ConnectionManager>,
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    ) -> Self {
        Self {
            pool,
            connections,
            app_handle,
            provider: RwLock::new(None),
            cache: std::sync::Mutex::new(HashMap::new()),
            dirty: AtomicBool::new(false),
            changed: Notify::new(),
            #[cfg(test)]
            emitted: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Install the app layer's snapshot builder. Called once at boot, before
    /// the network starts.
    pub async fn set_provider(&self, provider: Arc<dyn DeviceSnapshotProvider>) {
        *self.provider.write().await = Some(provider);
        tracing::info!("Device-mesh snapshot provider installed");
    }

    /// THIS device's snapshot right now, identity stamped by the engine.
    /// `None` while no provider is installed.
    pub async fn local_snapshot(&self) -> Result<Option<DeviceSnapshot>, AppError> {
        let Some(provider) = self.provider.read().await.clone() else {
            return Ok(None);
        };
        let mut snapshot = provider.build().await?;
        snapshot.peer_id = self.connections.local_peer_id().to_string();
        snapshot.display_name = self.connections.local_display_name().to_string();
        snapshot.sent_at_ms = now_ms();
        Ok(Some(snapshot))
    }

    /// Something a peer would see changed (the queue, a persona switch, a
    /// session's state). Debounced: the loop sends one snapshot
    /// [`CHANGE_DEBOUNCE`] after the first change of a burst. Cheap and
    /// non-blocking; safe from any thread.
    pub fn note_changed(&self) {
        self.dirty.store(true, Ordering::Release);
        self.changed.notify_one();
    }

    /// The debounce loop. Runs until `cancel` fires.
    pub(super) async fn run_change_loop(self: Arc<Self>, cancel: CancellationToken) {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = self.changed.notified() => {}
            }
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(CHANGE_DEBOUNCE) => {}
            }
            // A permit left by a change during the sleep wakes the loop once
            // more; the flag makes that second pass free.
            if self.dirty.swap(false, Ordering::AcqRel) {
                self.broadcast().await;
            }
        }
        tracing::info!("device-mesh change loop stopped");
    }

    /// Every paired device with a live authenticated connection, except this
    /// one. Pairing is the gate: a connected stranger never gets a snapshot.
    async fn connected_paired_peers(&self) -> Vec<String> {
        let devices = match owned_devices_repo::list_owned_devices(&self.pool) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "device mesh: could not list paired devices");
                return Vec::new();
            }
        };
        let local = self.connections.local_peer_id();
        let mut out = Vec::new();
        for device in devices {
            if device.peer_id != local && self.connections.is_connected(&device.peer_id).await {
                out.push(device.peer_id);
            }
        }
        out
    }

    /// This device's snapshot as wire JSON, or `None` (no provider, a build
    /// failure, or an oversized snapshot - each logged).
    async fn local_json(&self) -> Option<String> {
        let snapshot = match self.local_snapshot().await {
            Ok(Some(s)) => s,
            Ok(None) => return None,
            Err(e) => {
                tracing::warn!(error = %e, "device mesh: snapshot build failed; nothing sent");
                return None;
            }
        };
        let json = match serde_json::to_string(&snapshot) {
            Ok(j) => j,
            Err(e) => {
                tracing::warn!(error = %e, "device mesh: snapshot did not serialize");
                return None;
            }
        };
        if json.len() > MAX_SNAPSHOT_BYTES {
            tracing::warn!(
                bytes = json.len(),
                "device mesh: snapshot too large; not sent"
            );
            return None;
        }
        Some(json)
    }

    /// Send this device's snapshot to every connected paired device. Returns
    /// how many peers it was written to. Nothing is built when nobody is
    /// listening.
    pub async fn broadcast(&self) -> usize {
        let peers = self.connected_paired_peers().await;
        if peers.is_empty() {
            return 0;
        }
        let Some(json) = self.local_json().await else {
            return 0;
        };
        let mut sent = 0;
        for peer_id in peers {
            if self.deliver(&peer_id, json.clone()).await {
                sent += 1;
            }
        }
        sent
    }

    /// Send this device's snapshot to ONE peer (a link just came up), if it
    /// is paired. Returns whether it was written.
    pub async fn send_to(&self, peer_id: &str) -> bool {
        match owned_devices_repo::get_owned_device(&self.pool, peer_id) {
            Ok(Some(_)) => {}
            _ => return false,
        }
        let Some(json) = self.local_json().await else {
            return false;
        };
        self.deliver(peer_id, json).await
    }

    /// Best-effort one-way delivery: a snapshot that misses is superseded.
    async fn deliver(&self, peer_id: &str, json: String) -> bool {
        let sent = async {
            let (mut send, _recv) = self.connections.open_stream(peer_id).await?;
            protocol::write_message(&mut send, &Message::DeviceSnapshot { json }).await
        }
        .await;
        match sent {
            Ok(()) => true,
            Err(e) => {
                tracing::debug!(peer_id = %peer_id, "device snapshot not delivered now: {e}");
                false
            }
        }
    }

    // -- Receiving ---------------------------------------------------------

    /// Apply one snapshot frame from `peer_id`. The CALLER has already passed
    /// the pairing gate (`RemoteJobs::handle_message`).
    ///
    /// Refused, with nothing stored: an oversized or unreadable frame
    /// ([`AppError::Validation`]), and a snapshot whose `peer_id` is not the
    /// authenticated sender ([`AppError::Forbidden`]) - a paired device may
    /// speak only for itself.
    pub async fn apply_snapshot(&self, peer_id: &str, json: &str) -> Result<(), AppError> {
        if json.len() > MAX_SNAPSHOT_BYTES {
            return Err(AppError::Validation(format!(
                "device snapshot too large ({} bytes, limit {MAX_SNAPSHOT_BYTES})",
                json.len()
            )));
        }
        let snapshot: DeviceSnapshot = serde_json::from_str(json)
            .map_err(|e| AppError::Validation(format!("unreadable device snapshot: {e}")))?;
        if snapshot.peer_id != peer_id {
            return Err(AppError::Forbidden(format!(
                "Peer {peer_id} sent a device snapshot claiming to be {}",
                snapshot.peer_id
            )));
        }
        let received_at_ms = now_ms();
        self.cache.lock().unwrap_or_else(|e| e.into_inner()).insert(
            peer_id.to_string(),
            Cached {
                snapshot,
                received_at_ms,
                announced_live: true,
            },
        );
        // It just arrived over an authenticated link: connected by definition.
        self.emit_view(peer_id, DeviceReachability::Connected, received_at_ms)
            .await;
        Ok(())
    }

    /// Re-evaluate liveness at `now_ms`. Returns every peer whose view turned
    /// `unknown` since the last call, each ONCE (the caller emits for them).
    pub fn expire_stale(&self, now_ms: f64) -> Vec<String> {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        let mut turned = Vec::new();
        for (peer_id, entry) in cache.iter_mut() {
            if entry.announced_live
                && liveness_at(Some(entry.received_at_ms), now_ms) == MeshLiveness::Unknown
            {
                entry.announced_live = false;
                turned.push(peer_id.clone());
            }
        }
        turned.sort();
        turned
    }

    /// One peer's cached snapshot, when it landed, and its liveness at `now_ms`.
    pub fn cached(
        &self,
        peer_id: &str,
        now_ms: f64,
    ) -> (Option<DeviceSnapshot>, Option<f64>, MeshLiveness) {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        match cache.get(peer_id) {
            Some(c) => (
                Some(c.snapshot.clone()),
                Some(c.received_at_ms),
                liveness_at(Some(c.received_at_ms), now_ms),
            ),
            None => (None, None, MeshLiveness::Unknown),
        }
    }

    /// The device-strip view of one PAIRED peer. The name and the home flag
    /// come from the pairing registry (a human confirmed them), falling back
    /// to the snapshot's claim only when the row is gone.
    pub fn view_of(
        &self,
        peer_id: &str,
        reachability: DeviceReachability,
        now_ms: f64,
    ) -> MeshDeviceView {
        let row = owned_devices_repo::get_owned_device(&self.pool, peer_id)
            .ok()
            .flatten();
        let (snapshot, received_at_ms, liveness) = self.cached(peer_id, now_ms);
        let last_probe = match mesh_probes::latest_for_peer(&self.pool, peer_id) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(peer_id = %peer_id, error = %e, "device mesh: probe read failed");
                None
            }
        };
        let display_name = row
            .as_ref()
            .map(|d| d.display_name.clone())
            .or_else(|| snapshot.as_ref().map(|s| s.display_name.clone()))
            .unwrap_or_else(|| peer_id.to_string());
        MeshDeviceView {
            peer_id: peer_id.to_string(),
            display_name,
            is_self: false,
            is_home: row.as_ref().is_some_and(|d| d.is_home),
            reachability,
            liveness,
            snapshot,
            received_at_ms,
            last_probe,
        }
    }

    /// Emit `network:device-snapshot` with one peer's current view.
    pub async fn emit_view(&self, peer_id: &str, reachability: DeviceReachability, now_ms: f64) {
        let view = self.view_of(peer_id, reachability, now_ms);
        self.publish(event_name::DEVICE_SNAPSHOT, &view).await;
    }

    async fn publish<P: Serialize + Clone>(&self, event: &'static str, payload: &P) {
        #[cfg(test)]
        if let Ok(value) = serde_json::to_value(payload) {
            self.emitted
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((event, value));
        }
        let guard = self.app_handle.read().await;
        if let Some(app) = guard.as_ref() {
            emit_event(app, event, payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liveness_flips_exactly_past_the_stale_window() {
        let at = 1_000_000.0;
        assert_eq!(liveness_at(None, at), MeshLiveness::Unknown);
        assert_eq!(liveness_at(Some(at), at), MeshLiveness::Live);
        assert_eq!(
            liveness_at(Some(at), at + SNAPSHOT_STALE_AFTER_MS),
            MeshLiveness::Live
        );
        assert_eq!(
            liveness_at(Some(at), at + SNAPSHOT_STALE_AFTER_MS + 1.0),
            MeshLiveness::Unknown
        );
    }
}
