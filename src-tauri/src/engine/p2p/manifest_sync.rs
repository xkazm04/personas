//! Manifest sync: exchange exposure manifests with connected peers.
//!
//! On connect, automatically requests the peer's manifest. Periodically
//! re-syncs every 30s for connected peers.

use std::sync::Arc;

use super::connection::ConnectionManager;
use super::protocol::{self, ManifestEntry, Message};
use super::types::PeerManifestEntry;
use crate::db::repos::resources::exposure as exposure_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Handles manifest exchange and storage.
pub struct ManifestSync {
    pool: DbPool,
    connections: Arc<ConnectionManager>,
}

impl ManifestSync {
    pub fn new(pool: DbPool, connections: Arc<ConnectionManager>) -> Self {
        Self { pool, connections }
    }

    /// Request and sync a manifest from a specific peer.
    pub async fn sync_manifest(&self, peer_id: &str) -> Result<(), AppError> {
        let quinn_conn = self.connections.get_quinn_conn(peer_id).await.ok_or_else(|| {
            AppError::NotFound(format!("Not connected to peer {}", peer_id))
        })?;

        let (send, recv) = quinn_conn.open_bi().await.map_err(|e| {
            AppError::Internal(format!("Failed to open manifest stream: {e}"))
        })?;

        let mut send = tokio::io::BufWriter::new(send);
        let mut recv = tokio::io::BufReader::new(recv);

        // Send ManifestRequest
        protocol::write_message(&mut send, &Message::ManifestRequest).await?;

        // Wait for ManifestResponse
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            protocol::decode(&mut recv),
        )
        .await
        .map_err(|_| AppError::Internal("Manifest sync timeout".into()))??;

        match response {
            Message::ManifestResponse { resources } => {
                self.upsert_peer_manifest(peer_id, &resources)?;
                tracing::debug!(
                    peer_id = %peer_id,
                    count = resources.len(),
                    "Synced peer manifest"
                );
                Ok(())
            }
            _ => Err(AppError::Internal("Expected ManifestResponse".into())),
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

    /// Run a single manifest sync pass: clean up expired exposures, then sync all connected peers.
    pub async fn run_periodic_sync(&self) -> Result<(), AppError> {
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

        for peer_id in peer_ids {
            if let Err(e) = self.sync_manifest(&peer_id).await {
                tracing::debug!(peer_id = %peer_id, "Periodic manifest sync failed: {}", e);
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
