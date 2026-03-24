//! Manifest sync: exchange exposure manifests with connected peers.
//!
//! On connect, automatically requests the peer's manifest. Periodically
//! re-syncs every 30s for connected peers.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use ts_rs::TS;

use super::connection::ConnectionManager;
use super::protocol::{self, ManifestEntry, Message};
use super::types::PeerManifestEntry;
use crate::db::repos::resources::exposure as exposure_repo;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::error::AppError;

/// Maximum manifest entries accepted from a single peer.
/// Prevents a malicious or misconfigured peer from causing unbounded DB inserts.
const MAX_MANIFEST_ENTRIES: usize = 1000;

/// Atomic counters for manifest sync observability.
struct ManifestSyncCounters {
    sync_rounds: AtomicU64,
    sync_successes: AtomicU64,
    sync_failures: AtomicU64,
    /// Cumulative sync duration in milliseconds (for averaging).
    total_sync_duration_ms: AtomicU64,
    /// Total manifest entries received across all syncs.
    total_entries_received: AtomicU64,
}

impl ManifestSyncCounters {
    fn new() -> Self {
        Self {
            sync_rounds: AtomicU64::new(0),
            sync_successes: AtomicU64::new(0),
            sync_failures: AtomicU64::new(0),
            total_sync_duration_ms: AtomicU64::new(0),
            total_entries_received: AtomicU64::new(0),
        }
    }
}

/// Serializable snapshot of manifest sync metrics for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSyncMetrics {
    pub sync_rounds: u64,
    pub sync_successes: u64,
    pub sync_failures: u64,
    pub avg_sync_duration_ms: Option<f64>,
    pub total_entries_received: u64,
}

/// Handles manifest exchange and storage.
pub struct ManifestSync {
    pool: DbPool,
    connections: Arc<ConnectionManager>,
    app_handle: RwLock<Option<tauri::AppHandle>>,
    /// Cached content hashes per peer to skip redundant DB writes.
    manifest_hashes: RwLock<HashMap<String, String>>,
    /// Sync performance counters.
    counters: ManifestSyncCounters,
}

impl ManifestSync {
    pub fn new(pool: DbPool, connections: Arc<ConnectionManager>) -> Self {
        Self {
            pool,
            connections,
            app_handle: RwLock::new(None),
            manifest_hashes: RwLock::new(HashMap::new()),
            counters: ManifestSyncCounters::new(),
        }
    }

    /// Compute a content hash of manifest entries for delta comparison.
    fn compute_manifest_hash(resources: &[ManifestEntry]) -> String {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        for entry in resources {
            entry.resource_type.hash(&mut hasher);
            entry.resource_id.hash(&mut hasher);
            entry.display_name.hash(&mut hasher);
            entry.access_level.hash(&mut hasher);
            entry.tags.hash(&mut hasher);
        }
        format!("{:x}", hasher.finish())
    }

    /// Set the app handle for emitting sync progress events.
    pub async fn set_app_handle(&self, app: tauri::AppHandle) {
        *self.app_handle.write().await = Some(app);
    }

    /// Emit a manifest sync progress event to the frontend.
    async fn emit_sync_progress(&self, peer_id: &str, synced: usize, total: usize, resource_count: usize) {
        if let Some(app) = self.app_handle.read().await.as_ref() {
            use tauri::Emitter;
            let _ = app.emit(event_name::P2P_MANIFEST_SYNC_PROGRESS, serde_json::json!({
                "peerId": peer_id,
                "synced": synced,
                "total": total,
                "resourceCount": resource_count,
                "syncedAt": chrono::Utc::now().to_rfc3339(),
            }));
        }
    }

    /// Request and sync a manifest from a specific peer.
    pub async fn sync_manifest(&self, peer_id: &str) -> Result<(), AppError> {
        let sync_start = std::time::Instant::now();

        // Wrap all network I/O (open_stream + write + read) in a single timeout
        // to prevent indefinite hangs on stalled peers that accept connections
        // but never read/write data (e.g. malicious or network-partitioned peers).
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            async {
                let (mut send, mut recv) = self.connections.open_stream(peer_id).await?;
                protocol::write_message(&mut send, &Message::ManifestRequest).await?;
                protocol::decode(&mut recv).await
            },
        )
        .await
        .map_err(|_| AppError::Internal(format!("Manifest sync timeout for peer {peer_id}")))?;

        let response = match result {
            Ok(r) => r,
            Err(e) => {
                self.counters.sync_failures.fetch_add(1, Ordering::Relaxed);
                return Err(e);
            }
        };

        match response {
            Message::ManifestResponse { resources } => {
                let entry_count = resources.len() as u64;
                let duration_ms = sync_start.elapsed().as_millis() as u64;

                // Reject oversized manifests to prevent DB insertion bombs
                if resources.len() > MAX_MANIFEST_ENTRIES {
                    self.counters.sync_failures.fetch_add(1, Ordering::Relaxed);
                    tracing::warn!(
                        peer_id = %peer_id,
                        count = resources.len(),
                        max = MAX_MANIFEST_ENTRIES,
                        "Rejected oversized manifest from peer"
                    );
                    return Err(AppError::Validation(format!(
                        "Manifest from peer {} exceeds maximum of {} entries",
                        peer_id, MAX_MANIFEST_ENTRIES
                    )));
                }

                // Delta check: skip DB writes if manifest content hasn't changed
                let new_hash = Self::compute_manifest_hash(&resources);
                {
                    let hashes = self.manifest_hashes.read().await;
                    if hashes.get(peer_id).map(|h| h.as_str()) == Some(new_hash.as_str()) {
                        self.counters.sync_successes.fetch_add(1, Ordering::Relaxed);
                        self.counters.total_sync_duration_ms.fetch_add(duration_ms, Ordering::Relaxed);
                        self.counters.total_entries_received.fetch_add(entry_count, Ordering::Relaxed);
                        tracing::debug!(
                            peer_id = %peer_id,
                            count = resources.len(),
                            duration_ms = duration_ms,
                            "Manifest unchanged, skipping DB write"
                        );
                        return Ok(());
                    }
                }

                self.upsert_peer_manifest(peer_id, &resources)?;
                self.manifest_hashes.write().await.insert(peer_id.to_string(), new_hash);

                self.counters.sync_successes.fetch_add(1, Ordering::Relaxed);
                self.counters.total_sync_duration_ms.fetch_add(duration_ms, Ordering::Relaxed);
                self.counters.total_entries_received.fetch_add(entry_count, Ordering::Relaxed);

                tracing::debug!(
                    peer_id = %peer_id,
                    count = resources.len(),
                    duration_ms = duration_ms,
                    "Synced peer manifest"
                );
                Ok(())
            }
            _ => {
                self.counters.sync_failures.fetch_add(1, Ordering::Relaxed);
                Err(AppError::Internal("Expected ManifestResponse".into()))
            }
        }
    }

    /// Handle an incoming ManifestRequest by building and returning our manifest.
    pub fn build_local_manifest(&self) -> Result<Vec<ManifestEntry>, AppError> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT resource_type, resource_id, display_name, access_level, tags
             FROM exposed_resources
             WHERE expires_at IS NULL OR expires_at > datetime('now')"
        )?;

        let entries = stmt.query_map([], |row| {
            let tags_json: String = row.get(4)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(ManifestEntry {
                resource_type: row.get(0)?,
                resource_id: row.get(1)?,
                display_name: row.get(2)?,
                access_level: row.get(3)?,
                tags,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    /// Upsert a peer's manifest entries into the peer_manifests table.
    fn upsert_peer_manifest(
        &self,
        peer_id: &str,
        resources: &[ManifestEntry],
    ) -> Result<(), AppError> {
        let mut conn = self.pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();

        // Wrap DELETE + INSERT in a transaction to prevent data loss on crash
        // or partial manifests from concurrent syncs.
        let tx = conn.transaction().map_err(|e| {
            AppError::Internal(format!("Failed to begin transaction: {e}"))
        })?;

        tx.execute(
            "DELETE FROM peer_manifests WHERE peer_id = ?1",
            rusqlite::params![peer_id],
        )?;

        let mut stmt = tx.prepare(
            "INSERT INTO peer_manifests (id, peer_id, resource_type, resource_id, display_name, access_level, tags, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
        )?;

        for entry in resources {
            let id = uuid::Uuid::new_v4().to_string();
            let tags_json = serde_json::to_string(&entry.tags)?;
            stmt.execute(rusqlite::params![
                id,
                peer_id,
                entry.resource_type,
                entry.resource_id,
                entry.display_name,
                entry.access_level,
                tags_json,
                now,
            ])?;
        }

        drop(stmt);
        tx.commit().map_err(|e| {
            AppError::Internal(format!("Failed to commit manifest transaction: {e}"))
        })?;

        Ok(())
    }

    /// Get the synced manifest for a peer.
    pub fn get_peer_manifest(&self, peer_id: &str) -> Result<Vec<PeerManifestEntry>, AppError> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, peer_id, resource_type, resource_id, display_name, access_level, tags, synced_at
             FROM peer_manifests
             WHERE peer_id = ?1
             ORDER BY display_name"
        )?;

        let entries = stmt.query_map(rusqlite::params![peer_id], |row| {
            let tags_json: String = row.get(6)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(PeerManifestEntry {
                id: row.get(0)?,
                peer_id: row.get(1)?,
                resource_type: row.get(2)?,
                resource_id: row.get(3)?,
                display_name: row.get(4)?,
                access_level: row.get(5)?,
                tags,
                synced_at: row.get(7)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    /// Return a point-in-time snapshot of manifest sync metrics.
    pub fn get_metrics(&self) -> ManifestSyncMetrics {
        let successes = self.counters.sync_successes.load(Ordering::Relaxed);
        let total_duration = self.counters.total_sync_duration_ms.load(Ordering::Relaxed);
        let avg_sync_duration_ms = if successes > 0 {
            Some(total_duration as f64 / successes as f64)
        } else {
            None
        };
        ManifestSyncMetrics {
            sync_rounds: self.counters.sync_rounds.load(Ordering::Relaxed),
            sync_successes: successes,
            sync_failures: self.counters.sync_failures.load(Ordering::Relaxed),
            avg_sync_duration_ms,
            total_entries_received: self.counters.total_entries_received.load(Ordering::Relaxed),
        }
    }

    /// Run a single manifest sync pass: clean up expired exposures, then sync all connected peers.
    pub async fn run_periodic_sync(&self) -> Result<(), AppError> {
        self.counters.sync_rounds.fetch_add(1, Ordering::Relaxed);
        // Clean up expired exposures each cycle
        match exposure_repo::cleanup_expired_exposures(&self.pool) {
            Ok(count) if count > 0 => {
                tracing::info!(count, "Cleaned up expired exposures");
            }
            Err(e) => {
                tracing::warn!("Failed to clean up expired exposures: {}", e);
            }
            _ => {}
        }

        // Get list of connected peer IDs from discovered_peers
        let peer_ids = self.get_connected_peer_ids()?;
        let total = peer_ids.len();

        for (i, peer_id) in peer_ids.iter().enumerate() {
            match self.sync_manifest(peer_id).await {
                Ok(()) => {
                    // Emit progress with resource count from the synced manifest
                    let resource_count = self.get_peer_manifest(peer_id)
                        .map(|m| m.len())
                        .unwrap_or(0);
                    self.emit_sync_progress(peer_id, i + 1, total, resource_count).await;
                }
                Err(e) => {
                    tracing::debug!(peer_id = %peer_id, "Periodic manifest sync failed: {}", e);
                }
            }
        }
        Ok(())
    }

    /// Periodic manifest sync loop (runs every 30s for all connected peers).
    /// Prefer using `PeriodicTask` + `run_periodic_sync` for new code.
    pub async fn periodic_sync_loop(&self) {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let _ = self.run_periodic_sync().await;
        }
    }

    /// Get peer_ids of currently connected peers.
    fn get_connected_peer_ids(&self) -> Result<Vec<String>, AppError> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT peer_id FROM discovered_peers WHERE is_connected = 1"
        )?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }
}
