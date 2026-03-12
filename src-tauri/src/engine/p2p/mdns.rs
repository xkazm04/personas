//! mDNS-based LAN peer discovery.
//!
//! Registers the local node as `_personas._tcp.local.` and continuously
//! browses for other peers on the network, upserting discovered peers
//! into the `discovered_peers` DB table.
//!
//! All data from mDNS TXT records is validated before database insertion
//! to prevent peer-id spoofing and address poisoning attacks.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;

use crate::db::DbPool;
use crate::error::AppError;

const SERVICE_TYPE: &str = "_personas._tcp.local.";

/// Maximum length for a display_name received via mDNS.
const MAX_DISPLAY_NAME_LEN: usize = 128;

/// Maximum number of addresses we store per peer.
const MAX_ADDRESSES: usize = 8;

/// Expected decoded length of a peer_id (SHA-256 = 32 bytes).
const PEER_ID_DECODED_LEN: usize = 32;

/// Outcome of validating raw mDNS peer data.
struct ValidatedPeerData {
    peer_id: String,
    display_name: String,
    addresses: Vec<String>,
    trust_status: String,
}

/// Validate a peer_id: must be valid base58 decoding to exactly 32 bytes (SHA-256).
fn validate_peer_id(raw: &str) -> bool {
    if raw.is_empty() || raw.len() > 64 {
        return false;
    }
    match bs58::decode(raw).into_vec() {
        Ok(bytes) => bytes.len() == PEER_ID_DECODED_LEN,
        Err(_) => false,
    }
}

/// Sanitise a display_name: trim whitespace and truncate to MAX_DISPLAY_NAME_LEN.
fn sanitise_display_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() > MAX_DISPLAY_NAME_LEN {
        trimmed[..MAX_DISPLAY_NAME_LEN].to_string()
    } else if trimmed.is_empty() {
        "Unknown Peer".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Validate and cap addresses: each must parse as a valid SocketAddr.
fn validate_addresses(raw: Vec<String>) -> Vec<String> {
    raw.into_iter()
        .filter(|addr| addr.parse::<SocketAddr>().is_ok())
        .take(MAX_ADDRESSES)
        .collect()
}

/// Check whether a peer_id exists in the trusted_peers table (non-revoked).
fn is_trusted_peer(pool: &DbPool, peer_id: &str) -> bool {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return false,
    };
    conn.query_row(
        "SELECT COUNT(*) FROM trusted_peers WHERE peer_id = ?1 AND trust_level != 'revoked'",
        rusqlite::params![peer_id],
        |row| row.get::<_, i32>(0),
    )
    .unwrap_or(0)
        > 0
}

/// Validate all fields from an mDNS TXT record before DB insertion.
/// Returns `None` if the data is invalid and should be dropped.
fn validate_mdns_peer(
    pool: &DbPool,
    raw_peer_id: &str,
    raw_display_name: &str,
    raw_addresses: Vec<String>,
) -> Option<ValidatedPeerData> {
    // 1. peer_id: must be valid base58-encoded SHA-256
    if !validate_peer_id(raw_peer_id) {
        tracing::warn!(
            peer_id = %raw_peer_id,
            "mDNS: rejected peer with invalid peer_id format"
        );
        return None;
    }

    // 2. display_name: sanitise
    let display_name = sanitise_display_name(raw_display_name);

    // 3. addresses: validate format and cap count
    let addresses = validate_addresses(raw_addresses);
    if addresses.is_empty() {
        tracing::warn!(
            peer_id = %raw_peer_id,
            "mDNS: rejected peer with no valid addresses"
        );
        return None;
    }

    // 4. Cross-reference with trusted_peers
    let trust_status = if is_trusted_peer(pool, raw_peer_id) {
        "trusted".to_string()
    } else {
        "unknown".to_string()
    };

    if trust_status == "unknown" {
        tracing::info!(
            peer_id = %raw_peer_id,
            display_name = %display_name,
            "mDNS: discovered untrusted peer"
        );
    }

    Some(ValidatedPeerData {
        peer_id: raw_peer_id.to_string(),
        display_name,
        addresses,
        trust_status,
    })
}

/// Buffered peer data awaiting batch flush.
struct BufferedPeer {
    display_name: String,
    addresses_json: String,
    trust_status: String,
    last_seen_at: String,
}

/// mDNS service registration and browsing.
pub struct MdnsService {
    pool: DbPool,
    daemon: Mutex<Option<mdns_sd::ServiceDaemon>>,
    service_fullname: Mutex<Option<String>>,
    /// Buffer of validated peers keyed by peer_id, flushed periodically.
    pending_peers: Mutex<HashMap<String, BufferedPeer>>,
}

impl MdnsService {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            daemon: Mutex::new(None),
            service_fullname: Mutex::new(None),
            pending_peers: Mutex::new(HashMap::new()),
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
    ///
    /// Discovered peers are buffered in memory and flushed to the DB
    /// in a single transaction every 3 seconds, avoiding per-event DB writes.
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

        let mut flush_interval = tokio::time::interval(std::time::Duration::from_secs(3));
        // First tick completes immediately — skip it so we don't flush an empty buffer.
        flush_interval.tick().await;

        loop {
            tokio::select! {
                event = receiver.recv_async() => {
                    match event {
                        Ok(ev) => self.buffer_mdns_event(&pool, ev),
                        Err(_) => {
                            tracing::warn!("mDNS browse channel closed");
                            // Flush remaining buffered peers before exiting.
                            self.flush_pending_peers(&pool);
                            break;
                        }
                    }
                }
                _ = flush_interval.tick() => {
                    self.flush_pending_peers(&pool);
                }
            }
        }
    }

    /// Validate a single mDNS event and buffer the peer for batch flush.
    fn buffer_mdns_event(&self, pool: &DbPool, event: mdns_sd::ServiceEvent) {
        match event {
            mdns_sd::ServiceEvent::ServiceResolved(info) => {
                let raw_peer_id = info
                    .get_properties()
                    .get_property_val_str("peer_id")
                    .unwrap_or_default()
                    .to_string();
                let raw_display_name = info
                    .get_properties()
                    .get_property_val_str("display_name")
                    .unwrap_or_default()
                    .to_string();

                let raw_addresses: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .map(|addr| format!("{}:{}", addr, info.get_port()))
                    .collect();

                // Validate all mDNS data before buffering
                let validated = match validate_mdns_peer(
                    pool,
                    &raw_peer_id,
                    &raw_display_name,
                    raw_addresses,
                ) {
                    Some(v) => v,
                    None => return,
                };

                let addresses_json =
                    serde_json::to_string(&validated.addresses).unwrap_or_default();
                let now = chrono::Utc::now().to_rfc3339();

                tracing::debug!(
                    peer_id = %validated.peer_id,
                    display_name = %validated.display_name,
                    trust_status = %validated.trust_status,
                    "mDNS peer buffered for batch upsert"
                );

                // Buffer the peer; later entries for the same peer_id overwrite earlier ones.
                if let Ok(mut buf) = self.pending_peers.lock() {
                    buf.insert(validated.peer_id, BufferedPeer {
                        display_name: validated.display_name,
                        addresses_json,
                        trust_status: validated.trust_status,
                        last_seen_at: now,
                    });
                }
            }
            mdns_sd::ServiceEvent::ServiceRemoved(_type, fullname) => {
                tracing::debug!("mDNS service removed: {}", fullname);
            }
            _ => {}
        }
    }

    /// Flush all buffered peers to the DB in a single transaction.
    fn flush_pending_peers(&self, pool: &DbPool) {
        let batch: HashMap<String, BufferedPeer> = {
            let mut buf = match self.pending_peers.lock() {
                Ok(b) => b,
                Err(_) => return,
            };
            if buf.is_empty() {
                return;
            }
            std::mem::take(&mut *buf)
        };

        let count = batch.len();
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("DB pool error in mDNS flush: {}", e);
                return;
            }
        };

        // Use a transaction so all upserts share a single fsync.
        if let Err(e) = conn.execute_batch("BEGIN") {
            tracing::warn!("mDNS flush BEGIN failed: {}", e);
            return;
        }

        let mut ok = true;
        for (peer_id, peer) in &batch {
            let result = conn.execute(
                "INSERT INTO discovered_peers (peer_id, display_name, addresses, last_seen_at, first_seen_at, is_connected, metadata, trust_status)
                 VALUES (?1, ?2, ?3, ?4, ?4, 0, NULL, ?5)
                 ON CONFLICT(peer_id) DO UPDATE SET
                    display_name = ?2,
                    addresses = ?3,
                    last_seen_at = ?4,
                    trust_status = ?5",
                rusqlite::params![
                    peer_id,
                    peer.display_name,
                    peer.addresses_json,
                    peer.last_seen_at,
                    peer.trust_status,
                ],
            );
            if let Err(e) = result {
                tracing::warn!("Failed to upsert peer {}: {}", peer_id, e);
                ok = false;
                break;
            }
        }

        if ok {
            if let Err(e) = conn.execute_batch("COMMIT") {
                tracing::warn!("mDNS flush COMMIT failed: {}", e);
                let _ = conn.execute_batch("ROLLBACK");
            } else {
                tracing::debug!("mDNS batch flushed {} peers", count);
            }
        } else {
            let _ = conn.execute_batch("ROLLBACK");
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
            "SELECT peer_id, display_name, addresses, last_seen_at, first_seen_at, is_connected, metadata, trust_status
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
                trust_status: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "unknown".to_string()),
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(peers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_peer_id_accepted() {
        // SHA-256 produces 32 bytes; base58-encode 32 zero-bytes
        let id = bs58::encode([0u8; 32]).into_string();
        assert!(validate_peer_id(&id));
    }

    #[test]
    fn short_peer_id_rejected() {
        assert!(!validate_peer_id("abc"));
    }

    #[test]
    fn empty_peer_id_rejected() {
        assert!(!validate_peer_id(""));
    }

    #[test]
    fn invalid_base58_rejected() {
        // '0', 'O', 'I', 'l' are not in the base58 alphabet
        assert!(!validate_peer_id("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"));
    }

    #[test]
    fn wrong_length_rejected() {
        // 16 bytes instead of 32
        let id = bs58::encode([0u8; 16]).into_string();
        assert!(!validate_peer_id(&id));
    }

    #[test]
    fn display_name_truncated() {
        let long = "A".repeat(300);
        let result = sanitise_display_name(&long);
        assert_eq!(result.len(), MAX_DISPLAY_NAME_LEN);
    }

    #[test]
    fn empty_display_name_gets_default() {
        assert_eq!(sanitise_display_name(""), "Unknown Peer");
        assert_eq!(sanitise_display_name("   "), "Unknown Peer");
    }

    #[test]
    fn display_name_trimmed() {
        assert_eq!(sanitise_display_name("  Alice  "), "Alice");
    }

    #[test]
    fn valid_addresses_pass() {
        let addrs = vec!["192.168.1.1:4242".to_string(), "10.0.0.1:4242".to_string()];
        let result = validate_addresses(addrs);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn invalid_addresses_filtered() {
        let addrs = vec![
            "192.168.1.1:4242".to_string(),
            "not-an-address".to_string(),
            "999.999.999.999:99999".to_string(),
        ];
        let result = validate_addresses(addrs);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "192.168.1.1:4242");
    }

    #[test]
    fn addresses_capped_at_max() {
        let addrs: Vec<String> = (0..20)
            .map(|i| format!("192.168.1.{}:4242", i))
            .collect();
        let result = validate_addresses(addrs);
        assert_eq!(result.len(), MAX_ADDRESSES);
    }
}
