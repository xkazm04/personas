import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Types — the ts-rs bindings ARE the contract; these were hand-copied until
// 2026-10-19 and are re-exported so existing imports keep working.
// ============================================================================

import type { DiscoveredPeer } from "@/lib/bindings/DiscoveredPeer";
import type { PeerManifestEntry } from "@/lib/bindings/PeerManifestEntry";
import type { NetworkStatusInfo } from "@/lib/bindings/NetworkStatusInfo";
import type { NetworkSnapshot } from "@/lib/bindings/NetworkSnapshot";

export type { ConnectionState } from "@/lib/bindings/ConnectionState";
export type { DiscoveredPeer, PeerManifestEntry, NetworkStatusInfo, NetworkSnapshot };
export type { ConnectionHealth } from "@/lib/bindings/ConnectionHealth";
export type { MessagingMetrics } from "@/lib/bindings/MessagingMetrics";
export type { ConnectionMetricsSnapshot } from "@/lib/bindings/ConnectionMetricsSnapshot";
export type { ManifestSyncMetrics } from "@/lib/bindings/ManifestSyncMetrics";

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

export const getNetworkSnapshot = () =>
  invoke<NetworkSnapshot>("get_network_snapshot");
