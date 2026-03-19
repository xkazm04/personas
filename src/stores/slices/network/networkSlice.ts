import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { errMsg, reportError } from "../../storeTypes";
import { useAgentStore } from "../../agentStore";
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

/** Number of consecutive poll failures before surfacing a staleness warning. */
const STALE_THRESHOLD = 3;

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
  updateExposedResource: (id: string, input: exposureApi.UpdateExposedResourceInput) => Promise<void>;
  deleteExposedResource: (id: string) => Promise<void>;

  // Provenance actions
  fetchProvenance: () => Promise<void>;

  // Bundle actions
  exportBundle: (resourceIds: string[], savePath: string) => Promise<bundleApi.BundleExportResult>;
  previewBundleImport: (filePath: string) => Promise<BundleImportPreview>;
  applyBundleImport: (filePath: string, options: bundleApi.BundleImportOptions) => Promise<bundleApi.BundleImportResult>;

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

  // -- Identity --------------------------------------------------------

  fetchLocalIdentity: async () => {
    try {
      const identity = await identityApi.getLocalIdentity();
      set({ localIdentity: identity });
    } catch (err) {
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

  updateExposedResource: async (id, input) => {
    try {
      await exposureApi.updateExposedResource(id, input);
      await get().fetchExposedResources();
    } catch (err) {
      reportError(err, "Failed to update exposed resource", set);
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

  applyBundleImport: async (filePath, options) => {
    set({ networkLoading: true });
    try {
      const result = await bundleApi.applyBundleImport(filePath, options);
      set({ networkLoading: false });
      // Refresh personas list after import
      await useAgentStore.getState().fetchPersonas();
      await get().fetchProvenance();
      return result;
    } catch (err) {
      reportError(err, "Failed to import bundle", set, { stateUpdates: { networkLoading: false } });
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
      set({ discoveredPeers: peers, networkConsecutiveFailures: 0, networkError: null });
    } catch (err) {
      const failures = get().networkConsecutiveFailures + 1;
      set({
        networkConsecutiveFailures: failures,
        networkError: failures >= STALE_THRESHOLD
          ? errMsg(err, "Network backend unreachable")
          : null,
      });
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
      set({ networkStatus: status, networkConsecutiveFailures: 0, networkError: null });
    } catch (err) {
      const failures = get().networkConsecutiveFailures + 1;
      set({
        networkConsecutiveFailures: failures,
        networkError: failures >= STALE_THRESHOLD
          ? errMsg(err, "Network backend unreachable")
          : null,
      });
    }
  },

  fetchNetworkSnapshot: async () => {
    try {
      const snapshot = await discoveryApi.getNetworkSnapshot();
      set({
        networkStatus: snapshot.status,
        connectionHealth: snapshot.health,
        discoveredPeers: snapshot.discoveredPeers,
        messagingMetrics: snapshot.messagingMetrics,
        connectionMetrics: snapshot.connectionMetrics,
        manifestSyncMetrics: snapshot.manifestSyncMetrics,
        networkConsecutiveFailures: 0,
        networkError: null,
      });
    } catch (err) {
      const failures = get().networkConsecutiveFailures + 1;
      set({
        networkConsecutiveFailures: failures,
        networkError: failures >= STALE_THRESHOLD
          ? errMsg(err, "Network backend unreachable")
          : null,
      });
    }
  },
});
