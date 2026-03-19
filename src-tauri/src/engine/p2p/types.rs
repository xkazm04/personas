//! Shared types for the P2P networking layer.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Network configuration.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NetworkConfig {
    pub port: u16,
    pub auto_connect: bool,
    pub max_peers: usize,
    pub health_check_interval_secs: u64,
    pub manifest_sync_interval_secs: u64,
    pub stale_peer_timeout_secs: u64,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            port: 4242,
            auto_connect: false,
            max_peers: 32,
            health_check_interval_secs: 15,
            manifest_sync_interval_secs: 30,
            stale_peer_timeout_secs: 60,
        }
    }
}

/// Connection state for a peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Failed,
}

impl std::fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionState::Disconnected => write!(f, "disconnected"),
            ConnectionState::Connecting => write!(f, "connecting"),
            ConnectionState::Connected => write!(f, "connected"),
            ConnectionState::Failed => write!(f, "failed"),
        }
    }
}

/// A peer discovered via mDNS.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiscoveredPeer {
    pub peer_id: String,
    pub display_name: String,
    pub addresses: Vec<String>,
    pub last_seen_at: String,
    pub first_seen_at: String,
    pub is_connected: bool,
    pub metadata: Option<String>,
    /// Trust status: "trusted" if peer_id is in trusted_peers, "unknown" otherwise.
    pub trust_status: String,
}

/// An entry in a peer's synced manifest.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PeerManifestEntry {
    pub id: String,
    pub peer_id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub access_level: String,
    pub tags: Vec<String>,
    pub synced_at: String,
}

/// Overall network status info.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NetworkStatusInfo {
    pub is_running: bool,
    pub listening_port: Option<u16>,
    pub discovered_peer_count: u32,
    pub connected_peer_count: u32,
    pub local_peer_id: String,
}

/// Info about a specific peer connection.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PeerConnectionInfo {
    pub peer_id: String,
    pub display_name: String,
    pub state: ConnectionState,
    pub connected_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_ping: Option<chrono::DateTime<chrono::Utc>>,
    pub last_latency_ms: Option<u64>,
    pub retry_count: u32,
}

/// Aggregate connection health across all peers.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealth {
    pub avg_latency_ms: Option<f64>,
    pub missed_ping_count: u32,
    pub connected_count: u32,
}

/// Reason a peer connection was terminated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DisconnectReason {
    /// User or application explicitly disconnected.
    User,
    /// Health-check (ping) failure.
    HealthCheck,
    /// Graceful shutdown via disconnect_all.
    Shutdown,
    /// Protocol error (version mismatch, unexpected message, etc.).
    ProtocolError,
}

/// Serializable snapshot of connection lifecycle metrics.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMetricsSnapshot {
    pub connections_established: u64,
    pub connections_dropped_health: u64,
    pub connections_dropped_user: u64,
    pub connections_dropped_shutdown: u64,
    pub connections_dropped_protocol: u64,
    pub connections_rejected_capacity: u64,
    /// Total outbound connection attempts (including failures).
    pub connection_attempts: u64,
    /// Average time from connect start to Connected state (ms), if any connections established.
    pub avg_connect_duration_ms: Option<f64>,
}

/// Combined snapshot of network status, health, and discovered peers.
/// Used to batch 3 separate polls into a single IPC call.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    pub status: NetworkStatusInfo,
    pub health: ConnectionHealth,
    pub discovered_peers: Vec<DiscoveredPeer>,
    pub messaging_metrics: super::messaging::MessagingMetrics,
    pub connection_metrics: ConnectionMetricsSnapshot,
    pub manifest_sync_metrics: super::manifest_sync::ManifestSyncMetrics,
}
