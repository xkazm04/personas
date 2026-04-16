import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { ArtistTab } from "@/lib/types/types";
import type { BlenderMcpStatus } from "@/api/artist";

export type GalleryMode = "2d" | "3d";
export type BlenderMcpState = "not-installed" | "installed" | "running" | "error";

export interface ConnectorInfo {
  id: string;
  name: string;
  connected: boolean;
  healthy: boolean;
}

/**
 * Asset handoff from Gallery → Media Studio. When a user clicks "Send to
 * Media Studio" on an AssetCard, the asset lands in this queue. The Media
 * Studio page drains the queue on mount and adds the items as image clips.
 */
export interface QueuedMediaAsset {
  id: string;
  filePath: string;
  fileName: string;
}

/**
 * Persisted creative-session record. Each prompt-run produces one of these
 * so the user can scroll through history and replay past conversations.
 */
export interface CreativeSessionRecord {
  id: string;
  startedAt: number;
  prompt: string;
  tools: string[];
  output: string[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

export interface ArtistSlice {
  artistTab: ArtistTab;
  galleryMode: GalleryMode;
  blenderMcpState: BlenderMcpState;
  artistFolder: string | null;

  // Cached Blender status — survives tab switches
  cachedBlenderStatus: BlenderMcpStatus | null;
  blenderStatusCheckedAt: number | null;

  // Creative session state
  creativeSessionId: string | null;
  creativeSessionRunning: boolean;
  creativeSessionOutput: string[];
  creativeSessions: CreativeSessionRecord[];

  // Connector statuses for creative tools
  creativeConnectors: ConnectorInfo[];

  // Pending handoff to Media Studio
  pendingMediaStudioAssets: QueuedMediaAsset[];

  // Actions
  setArtistTab: (tab: ArtistTab) => void;
  setGalleryMode: (mode: GalleryMode) => void;
  setBlenderMcpState: (state: BlenderMcpState) => void;
  setArtistFolder: (folder: string | null) => void;
  setCachedBlenderStatus: (status: BlenderMcpStatus | null) => void;
  setCreativeSessionId: (id: string | null) => void;
  setCreativeSessionRunning: (running: boolean) => void;
  appendCreativeOutput: (line: string) => void;
  clearCreativeOutput: () => void;
  setCreativeConnectors: (connectors: ConnectorInfo[]) => void;

  // Session history
  startCreativeSessionRecord: (record: CreativeSessionRecord) => void;
  appendCreativeSessionLine: (id: string, line: string) => void;
  finalizeCreativeSession: (id: string, status: CreativeSessionRecord['status']) => void;
  deleteCreativeSessionRecord: (id: string) => void;
  loadCreativeSessionIntoOutput: (id: string) => void;

  // Gallery → Media Studio handoff
  queueMediaStudioAsset: (asset: QueuedMediaAsset) => void;
  consumeMediaStudioAssets: () => QueuedMediaAsset[];
}

const MAX_OUTPUT_LINES = 500;
const MAX_SESSIONS = 25;
const MAX_SESSION_LINES = 300;

export const createArtistSlice: StateCreator<SystemStore, [], [], ArtistSlice> = (set, get) => ({
  artistTab: "blender" as ArtistTab,
  galleryMode: "2d" as GalleryMode,
  blenderMcpState: "not-installed" as BlenderMcpState,
  artistFolder: null,
  cachedBlenderStatus: null,
  blenderStatusCheckedAt: null,
  creativeSessionId: null,
  creativeSessionRunning: false,
  creativeSessionOutput: [],
  creativeSessions: [],
  creativeConnectors: [],
  pendingMediaStudioAssets: [],

  setArtistTab: (tab) => set({ artistTab: tab }),
  setGalleryMode: (mode) => set({ galleryMode: mode }),
  setBlenderMcpState: (state) => set({ blenderMcpState: state }),
  setArtistFolder: (folder) => set({ artistFolder: folder }),
  setCachedBlenderStatus: (status) =>
    set({ cachedBlenderStatus: status, blenderStatusCheckedAt: Date.now() }),
  setCreativeSessionId: (id) => set({ creativeSessionId: id }),
  setCreativeSessionRunning: (running) => set({ creativeSessionRunning: running }),
  appendCreativeOutput: (line) =>
    set((s) => ({
      creativeSessionOutput: [...s.creativeSessionOutput, line].slice(-MAX_OUTPUT_LINES),
    })),
  clearCreativeOutput: () => set({ creativeSessionOutput: [] }),
  setCreativeConnectors: (connectors) => set({ creativeConnectors: connectors }),

  startCreativeSessionRecord: (record) =>
    set((s) => ({
      creativeSessions: [record, ...s.creativeSessions].slice(0, MAX_SESSIONS),
    })),
  appendCreativeSessionLine: (id, line) =>
    set((s) => ({
      creativeSessions: s.creativeSessions.map((sess) =>
        sess.id === id
          ? { ...sess, output: [...sess.output, line].slice(-MAX_SESSION_LINES) }
          : sess,
      ),
    })),
  finalizeCreativeSession: (id, status) =>
    set((s) => ({
      creativeSessions: s.creativeSessions.map((sess) =>
        sess.id === id ? { ...sess, status } : sess,
      ),
    })),
  deleteCreativeSessionRecord: (id) =>
    set((s) => ({
      creativeSessions: s.creativeSessions.filter((sess) => sess.id !== id),
    })),
  loadCreativeSessionIntoOutput: (id) => {
    const sess = get().creativeSessions.find((r) => r.id === id);
    if (!sess) return;
    set({ creativeSessionOutput: sess.output.slice() });
  },

  queueMediaStudioAsset: (asset) =>
    set((s) => {
      if (s.pendingMediaStudioAssets.some((a) => a.id === asset.id)) return s;
      return { pendingMediaStudioAssets: [...s.pendingMediaStudioAssets, asset] };
    }),
  consumeMediaStudioAssets: () => {
    const queue = get().pendingMediaStudioAssets;
    if (queue.length === 0) return [];
    set({ pendingMediaStudioAssets: [] });
    return queue;
  },
});
