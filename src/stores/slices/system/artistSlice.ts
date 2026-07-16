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
 * Persisted Media Studio composition entry, surfaced as a "Recent" row on
 * the empty state so users can reopen the last few compositions without
 * walking the file dialog. Capped at MAX_MEDIA_STUDIO_RECENTS entries; the
 * most recent open or save bubbles to the head.
 */
export interface RecentMediaStudioComposition {
  /** Absolute path on disk. */
  path: string;
  /** Composition.name at the time of last open/save. */
  name: string;
  /** ms-epoch of the last open or save. */
  savedAt: number;
  /** Tiny JPEG data URL of the preview frame at save time. Keeps the recents
   *  row scannable at a glance. Sized ~160px wide so localStorage stays small. */
  thumbnailDataUrl?: string;
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

  // Most-recently-opened Media Studio compositions (capped, MRU order)
  mediaStudioRecents: RecentMediaStudioComposition[];

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

  // Media Studio recent compositions
  recordMediaStudioRecent: (entry: { path: string; name: string; thumbnailDataUrl?: string }) => void;
  removeMediaStudioRecent: (path: string) => void;
}

const MAX_OUTPUT_LINES = 500;
const MAX_SESSIONS = 25;
const MAX_SESSION_LINES = 300;
const MAX_MEDIA_STUDIO_RECENTS = 5;

/**
 * Flush interval (ms) for batching streamed creative-session lines into the
 * store. A running session streams many lines per second; a zustand `set()`
 * per line copies the output array (and maps the whole sessions list) and
 * notifies every subscriber per line. Buffering lines and flushing once per
 * interval keeps the UI fresh (~12 Hz) with one store write per window.
 */
const OUTPUT_FLUSH_INTERVAL_MS = 80;

export const createArtistSlice: StateCreator<SystemStore, [], [], ArtistSlice> = (set, get) => {
  // Pending streamed lines, buffered outside the store between flushes.
  const pendingOutput: string[] = [];
  const pendingSessionLines = new Map<string, string[]>();
  let flushScheduled = false;

  const flushPendingOutput = () => {
    flushScheduled = false;
    if (pendingOutput.length === 0 && pendingSessionLines.size === 0) return;
    // Snapshot and clear before set() so the updater stays pure.
    const outputBatch = pendingOutput.splice(0, pendingOutput.length);
    const sessionBatches = new Map(pendingSessionLines);
    pendingSessionLines.clear();
    set((s) => {
      const next: { creativeSessionOutput?: string[]; creativeSessions?: CreativeSessionRecord[] } = {};
      if (outputBatch.length > 0) {
        next.creativeSessionOutput =
          [...s.creativeSessionOutput, ...outputBatch].slice(-MAX_OUTPUT_LINES);
      }
      if (sessionBatches.size > 0) {
        next.creativeSessions = s.creativeSessions.map((sess) => {
          const lines = sessionBatches.get(sess.id);
          return lines
            ? { ...sess, output: [...sess.output, ...lines].slice(-MAX_SESSION_LINES) }
            : sess;
        });
      }
      return next;
    });
  };

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(flushPendingOutput, OUTPUT_FLUSH_INTERVAL_MS);
  };

  return {
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
  mediaStudioRecents: [],

  setArtistTab: (tab) => set({ artistTab: tab }),
  setGalleryMode: (mode) => set({ galleryMode: mode }),
  setBlenderMcpState: (state) => set({ blenderMcpState: state }),
  setArtistFolder: (folder) => set({ artistFolder: folder }),
  setCachedBlenderStatus: (status) =>
    set({ cachedBlenderStatus: status, blenderStatusCheckedAt: Date.now() }),
  setCreativeSessionId: (id) => set({ creativeSessionId: id }),
  setCreativeSessionRunning: (running) => set({ creativeSessionRunning: running }),
  appendCreativeOutput: (line) => {
    pendingOutput.push(line);
    // Cap the pending buffer so a chatty burst between flushes never holds
    // more than one window's worth of lines.
    if (pendingOutput.length > MAX_OUTPUT_LINES) {
      pendingOutput.splice(0, pendingOutput.length - MAX_OUTPUT_LINES);
    }
    scheduleFlush();
  },
  clearCreativeOutput: () => {
    // Drop any not-yet-flushed lines so they don't resurrect the output.
    pendingOutput.length = 0;
    set({ creativeSessionOutput: [] });
  },
  setCreativeConnectors: (connectors) => set({ creativeConnectors: connectors }),

  startCreativeSessionRecord: (record) =>
    set((s) => ({
      creativeSessions: [record, ...s.creativeSessions].slice(0, MAX_SESSIONS),
    })),
  appendCreativeSessionLine: (id, line) => {
    const buf = pendingSessionLines.get(id);
    if (buf) {
      buf.push(line);
      if (buf.length > MAX_SESSION_LINES) {
        buf.splice(0, buf.length - MAX_SESSION_LINES);
      }
    } else {
      pendingSessionLines.set(id, [line]);
    }
    scheduleFlush();
  },
  finalizeCreativeSession: (id, status) =>
    set((s) => ({
      creativeSessions: s.creativeSessions.map((sess) =>
        sess.id === id ? { ...sess, status } : sess,
      ),
    })),
  deleteCreativeSessionRecord: (id) => {
    pendingSessionLines.delete(id);
    set((s) => ({
      creativeSessions: s.creativeSessions.filter((sess) => sess.id !== id),
    }));
  },
  loadCreativeSessionIntoOutput: (id) => {
    // Flush buffered lines first so the loaded snapshot is not appended onto
    // by lines that logically arrived before the load.
    flushPendingOutput();
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

  recordMediaStudioRecent: ({ path, name, thumbnailDataUrl }) =>
    set((s) => {
      // Preserve a prior thumbnail when the caller does not supply one — Open
      // does not have a freshly-rendered preview to capture from, so it should
      // not wipe the last Save's thumbnail when it bubbles the entry to the top.
      const prior = s.mediaStudioRecents.find((r) => r.path === path);
      const filtered = s.mediaStudioRecents.filter((r) => r.path !== path);
      const next: RecentMediaStudioComposition = {
        path,
        name,
        savedAt: Date.now(),
        thumbnailDataUrl: thumbnailDataUrl ?? prior?.thumbnailDataUrl,
      };
      return {
        mediaStudioRecents: [next, ...filtered].slice(0, MAX_MEDIA_STUDIO_RECENTS),
      };
    }),
  removeMediaStudioRecent: (path) =>
    set((s) => ({
      mediaStudioRecents: s.mediaStudioRecents.filter((r) => r.path !== path),
    })),
  };
};
