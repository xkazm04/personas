import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Types
// ============================================================================

export type ConnectionState =
  | "Disconnected"
  | "Connecting"
  | "Connected"
  | "Failed";

export interface DiscoveredPeer {
  peer_id: string;
  display_name: string;
  addresses: string[];
  last_seen_at: string;
  first_seen_at: string;
  is_connected: boolean;
  metadata: string | null;
  /** Trust status: "trusted" if peer_id is in trusted_peers, "unknown" otherwise. */
  trust_status: string;
}

export interface PeerManifestEntry {
  id: string;
  peer_id: string;
  resource_type: string;
  resource_id: string;
  display_name: string;
  access_level: string;
  tags: string[];
  synced_at: string;
}

export interface NetworkStatusInfo {
  is_running: boolean;
  listening_port: number | null;
  discovered_peer_count: number;
  connected_peer_count: number;
  local_peer_id: string;
}

export interface ConnectionHealth {
  avgLatencyMs: number | null;
  missedPingCount: number;
  connectedCount: number;
}

export interface MessagingMetrics {
  messagesSent: number;
  messagesReceived: number;
  messagesDroppedBufferFull: number;
  messagesRateLimited: number;
  bytesSent: number;
  bytesReceived: number;
}

export interface ConnectionMetricsSnapshot {
  connectionsEstablished: number;
  connectionsDroppedHealth: number;
  connectionsDroppedUser: number;
  connectionsDroppedShutdown: number;
  connectionsDroppedProtocol: number;
  connectionsRejectedCapacity: number;
  connectionAttempts: number;
  avgConnectDurationMs: number | null;
}

export interface ManifestSyncMetrics {
  syncRounds: number;
  syncSuccesses: number;
  syncFailures: number;
  avgSyncDurationMs: number | null;
  totalEntriesReceived: number;
}

export interface NetworkSnapshot {
  status: NetworkStatusInfo;
  health: ConnectionHealth;
  discoveredPeers: DiscoveredPeer[];
  messagingMetrics: MessagingMetrics;
  connectionMetrics: ConnectionMetricsSnapshot;
  manifestSyncMetrics: ManifestSyncMetrics;
}

// ============================================================================
// Discovery
// ============================================================================

export const getDiscoveredPeers = () =>
  invoke<DiscoveredPeer[]>("get_discovered_peers");

// ============================================================================
// Connection Management
// ============================================================================

export const connectToPeer = (peerId: string) =>
  invoke<void>("connect_to_peer", { peerId });

export const disconnectPeer = (peerId: string) =>
  invoke<void>("disconnect_peer", { peerId });

// ============================================================================
// Manifest Sync
// ============================================================================

export const getPeerManifest = (peerId: string) =>
  invoke<PeerManifestEntry[]>("get_peer_manifest", { peerId });

export const syncPeerManifest = (peerId: string) =>
  invoke<void>("sync_peer_manifest", { peerId });

// ============================================================================
// Network Status
// ============================================================================

export const getNetworkStatus = () =>
  invoke<NetworkStatusInfo>("get_network_status");

export const getConnectionHealth = () =>
  invoke<ConnectionHealth>("get_connection_health");

export const getNetworkSnapshot = () =>
  invoke<NetworkSnapshot>("get_network_snapshot");

export const getMessagingMetrics = () =>
  invoke<MessagingMetrics>("get_messaging_metrics");
