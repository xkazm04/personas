//! mDNS-based LAN peer discovery.
//!
//! Registers the local node as `_personas._tcp.local.` and continuously
//! browses for other peers on the network, upserting discovered peers
//! into the `discovered_peers` DB table.

use std::sync::Mutex;

use crate::db::DbPool;
use crate::error::AppError;

const SERVICE_TYPE: &str = "_personas._tcp.local.";

/// mDNS service registration and browsing.
pub struct MdnsService {
    pool: DbPool,
    daemon: Mutex<Option<mdns_sd::ServiceDaemon>>,
    service_fullname: Mutex<Option<String>>,
}

impl MdnsService {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            daemon: Mutex::new(None),
            service_fullname: Mutex::new(None),
        }
    }

    /// Register this node on the LAN via mDNS.
    pub fn register(
        &self,
        peer_id: &str,
        display_name: &str,
        port: u16,
    ) -> Result<(), AppError> {
        let daemon = mdns_sd::ServiceDaemon::new()
            .map_err(|e| AppError::Internal(format!("mDNS daemon creation failed: {e}")))?;

        let instance_name = format!("personas-{}", &peer_id[..8.min(peer_id.len())]);

        let properties = [
            ("peer_id", peer_id),
            ("display_name", display_name),
            ("version", &super::protocol::PROTOCOL_VERSION.to_string()),
        ];

        let service_info = mdns_sd::ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &format!("{}.local.", instance_name),
            "",
            port,
            &properties[..],
        )
        .map_err(|e| AppError::Internal(format!("mDNS ServiceInfo error: {e}")))?;

        let fullname = service_info.get_fullname().to_string();

        daemon
            .register(service_info)
            .map_err(|e| AppError::Internal(format!("mDNS register error: {e}")))?;

        tracing::info!(
            peer_id = peer_id,
            port = port,
            "mDNS service registered: {}",
            fullname
        );

        *self.daemon.lock().unwrap() = Some(daemon);
        *self.service_fullname.lock().unwrap() = Some(fullname);

        Ok(())
    }

    /// Unregister from mDNS.
    pub fn unregister(&self) {
        let daemon = self.daemon.lock().unwrap().take();
        let fullname = self.service_fullname.lock().unwrap().take();

        if let (Some(daemon), Some(fullname)) = (daemon, fullname) {
            let _ = daemon.unregister(&fullname);
            let _ = daemon.shutdown();
            tracing::info!("mDNS service unregistered");
        }
    }

    /// Continuous mDNS browsing loop. Should run in a tokio::spawn task.
    pub async fn browse_loop(&self, pool: DbPool) {
        // Create a separate daemon for browsing
        let daemon = match mdns_sd::ServiceDaemon::new() {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("mDNS browse daemon creation failed: {}", e);
                return;
            }
        };

        let receiver = match daemon.browse(SERVICE_TYPE) {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("mDNS browse failed: {}", e);
                return;
            }
        };

        tracing::info!("mDNS browsing started for {}", SERVICE_TYPE);

        loop {
            match receiver.recv_async().await {
                Ok(event) => {
                    self.handle_mdns_event(&pool, event);
                }
                Err(_) => {
                    tracing::warn!("mDNS browse channel closed");
                    break;
                }
            }
        }
    }

    /// Handle a single mDNS event.
    fn handle_mdns_event(&self, pool: &DbPool, event: mdns_sd::ServiceEvent) {
        match event {
            mdns_sd::ServiceEvent::ServiceResolved(info) => {
                let peer_id = info
                    .get_properties()
                    .get_property_val_str("peer_id")
                    .unwrap_or_default()
                    .to_string();
                let display_name = info
                    .get_properties()
                    .get_property_val_str("display_name")
                    .unwrap_or_default()
                    .to_string();

                if peer_id.is_empty() {
                    return;
                }

                let addresses: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .map(|addr| format!("{}:{}", addr, info.get_port()))
                    .collect();

                if addresses.is_empty() {
                    return;
                }

                let addresses_json = serde_json::to_string(&addresses).unwrap_or_default();
                let now = chrono::Utc::now().to_rfc3339();

                match pool.get() {
                    Ok(conn) => {
                        let result = conn.execute(
                            "INSERT INTO discovered_peers (peer_id, display_name, addresses, last_seen_at, first_seen_at, is_connected, metadata)
                             VALUES (?1, ?2, ?3, ?4, ?4, 0, NULL)
                             ON CONFLICT(peer_id) DO UPDATE SET
                                display_name = ?2,
                                addresses = ?3,
                                last_seen_at = ?4",
                            rusqlite::params![peer_id, display_name, addresses_json, now],
                        );
                        if let Err(e) = result {
                            tracing::warn!("Failed to upsert discovered peer {}: {}", peer_id, e);
                        } else {
                            tracing::debug!(
                                peer_id = %peer_id,
                                display_name = %display_name,
                                "mDNS peer discovered/updated"
                            );
                        }
                    }
                    Err(e) => {
                        tracing::warn!("DB pool error in mDNS browse: {}", e);
                    }
                }
            }
            mdns_sd::ServiceEvent::ServiceRemoved(_type, fullname) => {
                tracing::debug!("mDNS service removed: {}", fullname);
            }
            _ => {}
        }
    }

    /// Prune peers not seen within the given timeout.
    pub fn prune_stale_peers(&self, timeout_secs: u64) -> Result<u64, AppError> {
        let cutoff = chrono::Utc::now()
            - chrono::Duration::seconds(timeout_secs as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let conn = self.pool.get()?;
        let deleted = conn.execute(
            "DELETE FROM discovered_peers WHERE last_seen_at < ?1 AND is_connected = 0",
            rusqlite::params![cutoff_str],
        )?;

        if deleted > 0 {
            tracing::debug!("Pruned {} stale discovered peers", deleted);
        }

        Ok(deleted as u64)
    }

    /// Get all discovered peers from DB.
    pub fn get_discovered_peers(&self) -> Result<Vec<super::types::DiscoveredPeer>, AppError> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT peer_id, display_name, addresses, last_seen_at, first_seen_at, is_connected, metadata
             FROM discovered_peers
             ORDER BY last_seen_at DESC"
        )?;

        let peers = stmt.query_map([], |row| {
            let addresses_json: String = row.get(2)?;
            let addresses: Vec<String> =
                serde_json::from_str(&addresses_json).unwrap_or_default();

            Ok(super::types::DiscoveredPeer {
                peer_id: row.get(0)?,
                display_name: row.get(1)?,
                addresses,
                last_seen_at: row.get(3)?,
                first_seen_at: row.get(4)?,
                is_connected: row.get::<_, i32>(5)? != 0,
                metadata: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(peers)
    }
}
