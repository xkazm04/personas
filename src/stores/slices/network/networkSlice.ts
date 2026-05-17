import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { errMsg, reportError } from "../../storeTypes";
import { storeBus } from "@/lib/storeBus";
import type { PeerIdentity, TrustedPeer } from "@/api/network/identity";
import type { ExposedResource, ResourceProvenance } from "@/api/network/exposure";
import type { BundleImportPreview } from "@/api/network/bundle";
import type {
  ConnectionHealth,
  ConnectionMetricsSnapshot,
  DiscoveredPeer,
  ManifestSyncMetrics,
  MessagingMetrics,
  PeerManifestEntry,
  ConnectionState,
  NetworkStatusInfo,
} from "@/api/network/discovery";
import * as identityApi from "@/api/network/identity";
import * as exposureApi from "@/api/network/exposure";
import * as bundleApi from "@/api/network/bundle";
import * as enclaveApi from "@/api/network/enclave";
import * as discoveryApi from "@/api/network/discovery";

/**
 * Number of consecutive poll failures — counted PER ENDPOINT — before
 * surfacing a "Network backend unreachable" warning.
 *
 * ## Semantics (revised 2026-04-28; see `idea-9ac76b08`)
 *
 * The previous shared counter was incorrect: when one poller succeeded while
 * another repeatedly failed, every success reset the shared counter to 0 and
 * the threshold was never reached, so the UI silently showed stale data
 * forever. This was particularly bad for partial backend outages where, e.g.,
 * `getNetworkSnapshot` kept working but `getDiscoveredPeers` was failing.
 *
 * Now each poller (`fetchDiscoveredPeers`, `fetchNetworkStatus`,
 * `fetchNetworkSnapshot`) maintains its own consecutive-failure count in
 * `networkFailureCounts`. The warning trips as soon as ANY single poller
 * crosses `STALE_THRESHOLD` consecutive failures.
 *
 * ### Reset contract
 * Only the specific poller that succeeded resets its own slot. A successful
 * snapshot does NOT mask repeated status-poll failures.
 *
 * ### Aggregate field
 * `networkConsecutiveFailures` (kept for backwards-compat with the
 * eventBridge bulk-reset path and the partial-match indicator) is derived as
 * `Math.max(...Object.values(networkFailureCounts))` so existing readers see
 * the worst endpoint's count.
 *
 * ### If you add a new poller
 * Use `bumpFailure(endpointKey)` and `clearFailure(endpointKey)` helpers — do
 * NOT mutate `networkConsecutiveFailures` directly. The eventBridge has a
 * legacy bulk-reset path (`networkConsecutiveFailures: 0`) that's still
 * supported and clears the entire `networkFailureCounts` map.
 */
export const STALE_THRESHOLD = 3;

/** Endpoint keys used as failure-counter slots. */
const ENDPOINT_DISCOVERED_PEERS = 'discoveredPeers';
const ENDPOINT_NETWORK_STATUS = 'networkStatus';
const ENDPOINT_NETWORK_SNAPSHOT = 'networkSnapshot';

/**
 * Detect a "command not found" error from Tauri. This happens when a backend
 * command is gated behind a Cargo feature (e.g. `p2p`) and the running build
 * doesn't include it — typical with `tauri:dev:lite`. We treat these as
 * "feature unavailable" rather than real errors so the Network tab can render
 * a single calm empty state instead of spamming three toasts.
 */
function isCommandUnavailableError(err: unknown): boolean {
  const msg = errMsg(err, '').toLowerCase();
  return msg.includes('not found') || msg.includes('not allowed by the scope') || msg.includes('command') && msg.includes('was not found');
}

export interface NetworkSlice {
  // State (Phase 1)
  localIdentity: PeerIdentity | null;
  trustedPeers: TrustedPeer[];
  exposedResources: ExposedResource[];
  provenance: ResourceProvenance[];
  networkLoading: boolean;

  // State (Phase 2: P2P Discovery)
  discoveredPeers: DiscoveredPeer[];
  peerManifests: Record<string, PeerManifestEntry[]>;
  connectionStates: Record<string, ConnectionState>;
  networkStatus: NetworkStatusInfo | null;
  connectionHealth: ConnectionHealth | null;
  messagingMetrics: MessagingMetrics | null;
  connectionMetrics: ConnectionMetricsSnapshot | null;
  manifestSyncMetrics: ManifestSyncMetrics | null;

  // Network health tracking
  networkError: string | null;
  networkConsecutiveFailures: number;
  /** Per-endpoint consecutive failure counts; each poller updates only its own slot. */
  networkFailureCounts: Record<string, number>;
  /**
   * True when the running build doesn't include the `p2p` Cargo feature, so
   * network/identity/snapshot commands aren't registered. UI surfaces should
   * render a "P2P unavailable in this build" empty state instead of error
   * banners when this is true.
   */
  p2pUnavailable: boolean;

  // Identity actions
  fetchLocalIdentity: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  exportIdentityCard: () => Promise<string>;

  // Trusted peers actions
  fetchTrustedPeers: () => Promise<void>;
  importTrustedPeer: (identityCard: string, notes?: string) => Promise<TrustedPeer>;
  revokePeerTrust: (peerId: string) => Promise<void>;
  deleteTrustedPeer: (peerId: string) => Promise<void>;

  // Exposure actions
  fetchExposedResources: () => Promise<void>;
  createExposedResource: (input: exposureApi.CreateExposedResourceInput) => Promise<ExposedResource>;
  deleteExposedResource: (id: string) => Promise<void>;

  // Provenance actions
  fetchProvenance: () => Promise<void>;

  // Bundle actions
  exportBundle: (resourceIds: string[], savePath: string) => Promise<bundleApi.BundleExportResult>;
  exportBundleToClipboard: (resourceIds: string[]) => Promise<bundleApi.ClipboardExportResult>;
  previewBundleImport: (filePath: string) => Promise<BundleImportPreview>;
  previewBundleFromClipboard: (base64Data: string) => Promise<BundleImportPreview>;
  applyBundleImport: (filePath: string, options: bundleApi.BundleImportOptions) => Promise<bundleApi.BundleImportResult>;
  applyBundleFromClipboard: (base64Data: string, options: bundleApi.BundleImportOptions) => Promise<bundleApi.BundleImportResult>;

  // Share link actions
  createShareLink: (resourceIds: string[]) => Promise<bundleApi.ShareLinkResult>;
  previewShareLink: (url: string) => Promise<BundleImportPreview>;
  importFromShareLink: (url: string, options: bundleApi.BundleImportOptions) => Promise<bundleApi.BundleImportResult>;

  // Enclave actions
  sealEnclave: (personaId: string, policy: enclaveApi.EnclavePolicy, savePath: string) => Promise<enclaveApi.EnclaveSealResult>;
  verifyEnclave: (filePath: string) => Promise<enclaveApi.EnclaveVerifyResult>;

  // Discovery actions (Phase 2)
  fetchDiscoveredPeers: () => Promise<void>;
  connectToPeer: (peerId: string) => Promise<void>;
  disconnectPeer: (peerId: string) => Promise<void>;
  fetchPeerManifest: (peerId: string) => Promise<void>;
  syncPeerManifest: (peerId: string) => Promise<void>;
  fetchNetworkStatus: () => Promise<void>;
  fetchNetworkSnapshot: () => Promise<void>;
}

export const createNetworkSlice: StateCreator<SystemStore, [], [], NetworkSlice> = (set, get) => ({
  // State (Phase 1)
  localIdentity: null,
  trustedPeers: [],
  exposedResources: [],
  provenance: [],
  networkLoading: false,

  // State (Phase 2)
  discoveredPeers: [],
  peerManifests: {},
  connectionStates: {},
  networkStatus: null,
  connectionHealth: null,
  messagingMetrics: null,
  connectionMetrics: null,
  manifestSyncMetrics: null,

  // Network health tracking
  networkError: null,
  networkConsecutiveFailures: 0,
  networkFailureCounts: {},
  p2pUnavailable: false,

  // -- Identity --------------------------------------------------------

  fetchLocalIdentity: async () => {
    try {
      const identity = await identityApi.getLocalIdentity();
      set({ localIdentity: identity });
    } catch (err) {
      if (isCommandUnavailableError(err)) {
        set({ p2pUnavailable: true });
        return;
      }
      reportError(err, "Failed to fetch identity", set);
    }
  },

  setDisplayName: async (name: string) => {
    try {
      const identity = await identityApi.setDisplayName(name);
      set({ localIdentity: identity });
    } catch (err) {
      reportError(err, "Failed to update display name", set);
      throw err;
    }
  },

  exportIdentityCard: async () => {
    try {
      return await identityApi.exportIdentityCard();
    } catch (err) {
      reportError(err, "Failed to export identity card", set);
      throw err;
    }
  },

  // -- Trusted Peers --------------------------------------------------

  fetchTrustedPeers: async () => {
    try {
      const peers = await identityApi.listTrustedPeers();
      set({ trustedPeers: peers });
    } catch (err) {
      if (isCommandUnavailableError(err)) {
        set({ p2pUnavailable: true });
        return;
      }
      reportError(err, "Failed to fetch trusted peers", set);
    }
  },

  importTrustedPeer: async (identityCard: string, notes?: string) => {
    try {
      const peer = await identityApi.importTrustedPeer(identityCard, notes);
      await get().fetchTrustedPeers();
      return peer;
    } catch (err) {
      reportError(err, "Failed to import trusted peer", set);
      throw err;
    }
  },

  revokePeerTrust: async (peerId: string) => {
    try {
      await identityApi.revokePeerTrust(peerId);
      await get().fetchTrustedPeers();
    } catch (err) {
      reportError(err, "Failed to revoke peer trust", set);
      throw err;
    }
  },

  deleteTrustedPeer: async (peerId: string) => {
    try {
      await identityApi.deleteTrustedPeer(peerId);
      await get().fetchTrustedPeers();
    } catch (err) {
      reportError(err, "Failed to delete trusted peer", set);
      throw err;
    }
  },

  // -- Exposure -------------------------------------------------------

  fetchExposedResources: async () => {
    try {
      const resources = await exposureApi.listExposedResources();
      set({ exposedResources: resources });
    } catch (err) {
      if (isCommandUnavailableError(err)) {
        set({ p2pUnavailable: true });
        return;
      }
      reportError(err, "Failed to fetch exposed resources", set);
    }
  },

  createExposedResource: async (input) => {
    try {
      const resource = await exposureApi.createExposedResource(input);
      await get().fetchExposedResources();
      return resource;
    } catch (err) {
      reportError(err, "Failed to expose resource", set);
      throw err;
    }
  },

  deleteExposedResource: async (id) => {
    try {
      await exposureApi.deleteExposedResource(id);
      await get().fetchExposedResources();
    } catch (err) {
      reportError(err, "Failed to remove resource exposure", set);
      throw err;
    }
  },

  // -- Provenance -----------------------------------------------------

  fetchProvenance: async () => {
    try {
      const prov = await exposureApi.listProvenance();
      set({ provenance: prov });
    } catch (err) {
      reportError(err, "Failed to fetch provenance", set);
    }
  },

  // -- Bundle ---------------------------------------------------------

  exportBundle: async (resourceIds, savePath) => {
    set({ networkLoading: true });
    try {
      const result = await bundleApi.exportPersonaBundle(resourceIds, savePath);
      set({ networkLoading: false });
      return result;
    } catch (err) {
      reportError(err, "Failed to export bundle", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  exportBundleToClipboard: async (resourceIds) => {
    set({ networkLoading: true });
    try {
      const result = await bundleApi.exportBundleToClipboard(resourceIds);
      set({ networkLoading: false });
      return result;
    } catch (err) {
      reportError(err, "Failed to export bundle for clipboard", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  previewBundleImport: async (filePath) => {
    set({ networkLoading: true });
    try {
      const preview = await bundleApi.previewBundleImport(filePath);
      set({ networkLoading: false });
      return preview;
    } catch (err) {
      reportError(err, "Failed to preview bundle", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  previewBundleFromClipboard: async (base64Data) => {
    set({ networkLoading: true });
    try {
      const preview = await bundleApi.previewBundleFromClipboard(base64Data);
      set({ networkLoading: false });
      return preview;
    } catch (err) {
      reportError(err, "Failed to preview clipboard bundle", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  applyBundleImport: async (filePath, options) => {
    set({ networkLoading: true });
    try {
      const result = await bundleApi.applyBundleImport(filePath, options);
      set({ networkLoading: false });
      // Refresh personas list after import
      storeBus.emit('network:personas-changed');
      await get().fetchProvenance();
      return result;
    } catch (err) {
      reportError(err, "Failed to import bundle", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  applyBundleFromClipboard: async (base64Data, options) => {
    set({ networkLoading: true });
    try {
      const result = await bundleApi.applyBundleFromClipboard(base64Data, options);
      set({ networkLoading: false });
      storeBus.emit('network:personas-changed');
      await get().fetchProvenance();
      return result;
    } catch (err) {
      reportError(err, "Failed to import clipboard bundle", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  // -- Share Links ----------------------------------------------------

  createShareLink: async (resourceIds) => {
    set({ networkLoading: true });
    try {
      const result = await bundleApi.createShareLink(resourceIds);
      set({ networkLoading: false });
      return result;
    } catch (err) {
      reportError(err, "Failed to create share link", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  previewShareLink: async (url) => {
    set({ networkLoading: true });
    try {
      const preview = await bundleApi.previewShareLink(url);
      set({ networkLoading: false });
      return preview;
    } catch (err) {
      reportError(err, "Failed to preview share link", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  importFromShareLink: async (url, options) => {
    set({ networkLoading: true });
    try {
      const result = await bundleApi.importFromShareLink(url, options);
      set({ networkLoading: false });
      storeBus.emit('network:personas-changed');
      await get().fetchProvenance();
      return result;
    } catch (err) {
      reportError(err, "Failed to import from share link", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  // -- Enclaves -------------------------------------------------------

  sealEnclave: async (personaId, policy, savePath) => {
    set({ networkLoading: true });
    try {
      const result = await enclaveApi.sealEnclave(personaId, policy, savePath);
      set({ networkLoading: false });
      return result;
    } catch (err) {
      reportError(err, "Failed to seal enclave", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  verifyEnclave: async (filePath) => {
    set({ networkLoading: true });
    try {
      const result = await enclaveApi.verifyEnclave(filePath);
      set({ networkLoading: false });
      return result;
    } catch (err) {
      reportError(err, "Failed to verify enclave", set, { stateUpdates: { networkLoading: false } });
      throw err;
    }
  },

  // -- Discovery (Phase 2) --------------------------------------------

  fetchDiscoveredPeers: async () => {
    try {
      const peers = await discoveryApi.getDiscoveredPeers();
      set((s) => clearFailure(s, ENDPOINT_DISCOVERED_PEERS, { discoveredPeers: peers }));
    } catch (err) {
      if (isCommandUnavailableError(err)) {
        set({ p2pUnavailable: true });
        return;
      }
      set((s) => bumpFailure(s, ENDPOINT_DISCOVERED_PEERS, err));
    }
  },

  connectToPeer: async (peerId: string) => {
    try {
      set((s) => ({
        connectionStates: { ...s.connectionStates, [peerId]: "Connecting" as const },
      }));
      await discoveryApi.connectToPeer(peerId);
      set((s) => ({
        connectionStates: { ...s.connectionStates, [peerId]: "Connected" as const },
      }));
      await get().fetchDiscoveredPeers();
    } catch (err) {
      set((s) => ({
        connectionStates: { ...s.connectionStates, [peerId]: "Failed" as const },
      }));
      reportError(err, "Failed to connect to peer", set);
      throw err;
    }
  },

  disconnectPeer: async (peerId: string) => {
    try {
      await discoveryApi.disconnectPeer(peerId);
      set((s) => ({
        connectionStates: { ...s.connectionStates, [peerId]: "Disconnected" as const },
      }));
      await get().fetchDiscoveredPeers();
    } catch (err) {
      reportError(err, "Failed to disconnect peer", set);
      throw err;
    }
  },

  fetchPeerManifest: async (peerId: string) => {
    try {
      const manifest = await discoveryApi.getPeerManifest(peerId);
      set((s) => ({
        peerManifests: { ...s.peerManifests, [peerId]: manifest },
      }));
    } catch (err) {
      reportError(err, "Failed to fetch peer manifest", set);
    }
  },

  syncPeerManifest: async (peerId: string) => {
    try {
      await discoveryApi.syncPeerManifest(peerId);
      await get().fetchPeerManifest(peerId);
    } catch (err) {
      reportError(err, "Failed to sync peer manifest", set);
      throw err;
    }
  },

  fetchNetworkStatus: async () => {
    try {
      const status = await discoveryApi.getNetworkStatus();
      set((s) => clearFailure(s, ENDPOINT_NETWORK_STATUS, { networkStatus: status }));
    } catch (err) {
      if (isCommandUnavailableError(err)) {
        set({ p2pUnavailable: true });
        return;
      }
      set((s) => bumpFailure(s, ENDPOINT_NETWORK_STATUS, err));
    }
  },

  fetchNetworkSnapshot: async () => {
    if (get().p2pUnavailable) return;
    try {
      const snapshot = await discoveryApi.getNetworkSnapshot();
      set((s) =>
        clearFailure(s, ENDPOINT_NETWORK_SNAPSHOT, {
          networkStatus: snapshot.status,
          connectionHealth: snapshot.health,
          discoveredPeers: snapshot.discoveredPeers,
          messagingMetrics: snapshot.messagingMetrics,
          connectionMetrics: snapshot.connectionMetrics,
          manifestSyncMetrics: snapshot.manifestSyncMetrics,
        }),
      );
    } catch (err) {
      if (isCommandUnavailableError(err)) {
        set({ p2pUnavailable: true });
        return;
      }
      set((s) => bumpFailure(s, ENDPOINT_NETWORK_SNAPSHOT, err));
    }
  },
});

/**
 * Increment the per-endpoint failure counter for `endpoint`. Returns a
 * partial state update that:
 * - bumps `networkFailureCounts[endpoint]` by 1
 * - recomputes `networkConsecutiveFailures` as the max across all endpoints
 * - sets `networkError` iff any endpoint hit `STALE_THRESHOLD`
 *
 * Other endpoints' counters are left untouched — that is the entire point of
 * this rewrite. See the `STALE_THRESHOLD` doc comment for context.
 */
function bumpFailure(
  s: NetworkSlice,
  endpoint: string,
  err: unknown,
): Partial<NetworkSlice> {
  const counts = { ...s.networkFailureCounts, [endpoint]: (s.networkFailureCounts[endpoint] ?? 0) + 1 };
  const max = maxCount(counts);
  return {
    networkFailureCounts: counts,
    networkConsecutiveFailures: max,
    networkError: max >= STALE_THRESHOLD ? errMsg(err, "Network backend unreachable") : s.networkError,
  };
}

/**
 * Reset the per-endpoint failure counter for `endpoint` (and merge any
 * additional state updates the caller wants to commit). Other endpoints'
 * counters are preserved — a healthy snapshot does not mask repeated
 * status-poll failures.
 */
function clearFailure(
  s: NetworkSlice,
  endpoint: string,
  extra: Partial<NetworkSlice>,
): Partial<NetworkSlice> {
  // If this endpoint had no recorded failures, nothing to reset and the
  // aggregate cannot change — return the extras unchanged. Crucially we do
  // NOT touch `networkError` here: an unrelated endpoint may still be over
  // threshold, and the bug we're fixing is that one endpoint's success was
  // silently masking another endpoint's stale failures.
  const prior = s.networkFailureCounts[endpoint] ?? 0;
  if (prior === 0) {
    return { ...extra };
  }
  const counts = { ...s.networkFailureCounts };
  delete counts[endpoint];
  const max = maxCount(counts);
  return {
    ...extra,
    networkFailureCounts: counts,
    networkConsecutiveFailures: max,
    // Only clear the error if no remaining endpoint is still over threshold.
    networkError: max >= STALE_THRESHOLD ? s.networkError : null,
  };
}

function maxCount(counts: Record<string, number>): number {
  let max = 0;
  for (const v of Object.values(counts)) {
    if (v > max) max = v;
  }
  return max;
}
