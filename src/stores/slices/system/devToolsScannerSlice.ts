import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { DevIdea } from "@/lib/bindings/DevIdea";
import type { DevScan } from "@/lib/bindings/DevScan";
import * as devApi from "@/api/devTools/devTools";

export interface DevToolsScannerSlice {
  // -- Scanner ---------------------------------------------------------
  scanAgentSelection: string[];
  scanPhase: "idle" | "running" | "complete" | "error";
  scanResults: DevIdea[];
  currentScanId: string | null;

  setScanAgentSelection: (keys: string[]) => void;
  toggleScanAgent: (key: string) => void;
  runScan: (projectId: string, contextId?: string) => Promise<void>;
  fetchScan: (id: string) => Promise<DevScan>;
  fetchScans: (projectId?: string, limit?: number) => Promise<DevScan[]>;

  // -- Ideas -----------------------------------------------------------
  ideas: DevIdea[];
  ideasLoading: boolean;

  fetchIdeas: (projectId?: string, status?: string, category?: string, scanType?: string, limit?: number, offset?: number) => Promise<void>;
  getIdea: (id: string) => Promise<DevIdea>;
  updateIdea: (id: string, updates: { status?: string; title?: string; description?: string; category?: string; effort?: number; impact?: number; risk?: number; rejectionReason?: string }) => Promise<void>;
  deleteIdea: (id: string) => Promise<void>;
  bulkDeleteIdeas: (ids: string[]) => Promise<number>;
}

export const createDevToolsScannerSlice: StateCreator<SystemStore, [], [], DevToolsScannerSlice> = (set, get) => ({
  // -- Scanner state ---------------------------------------------------
  scanAgentSelection: [],
  scanPhase: "idle",
  scanResults: [],
  currentScanId: null,

  setScanAgentSelection: (keys) => {
    set({ scanAgentSelection: keys });
  },

  toggleScanAgent: (key) => {
    set((state) => {
      const exists = state.scanAgentSelection.includes(key);
      return {
        scanAgentSelection: exists
          ? state.scanAgentSelection.filter((k) => k !== key)
          : [...state.scanAgentSelection, key],
      };
    });
  },

  runScan: async (projectId, contextId) => {
    const { scanAgentSelection } = get();
    set({ scanPhase: "running", scanResults: [], currentScanId: null });
    try {
      const result = await devApi.runScan(projectId, scanAgentSelection, contextId);
      // The scan runs asynchronously via CLI — scan_id returned immediately.
      // Progress streams via "idea-scan-output" events, completion via "idea-scan-status".
      set({ currentScanId: (result as { scan_id: string }).scan_id, error: null });
    } catch (err) {
      reportError(err, "Scan failed", set, { stateUpdates: { scanPhase: "error" } });
      throw err;
    }
  },

  fetchScan: async (id) => {
    try {
      const scan = await devApi.getScan(id);
      return scan;
    } catch (err) {
      reportError(err, "Failed to fetch scan", set);
      throw err;
    }
  },

  fetchScans: async (projectId, limit) => {
    try {
      const scans = await devApi.listScans(projectId, limit);
      return scans;
    } catch (err) {
      reportError(err, "Failed to fetch scans", set);
      throw err;
    }
  },

  // -- Ideas state -----------------------------------------------------
  ideas: [],
  ideasLoading: false,

  fetchIdeas: async (projectId, status, category, scanType, limit, offset) => {
    set({ ideasLoading: true });
    try {
      const ideas = await devApi.listIdeas(projectId, status, category, scanType, limit, offset);
      set({ ideas, ideasLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch ideas", set, { stateUpdates: { ideasLoading: false } });
    }
  },

  getIdea: async (id) => {
    try {
      return await devApi.getIdea(id);
    } catch (err) {
      reportError(err, "Failed to fetch idea", set);
      throw err;
    }
  },

  updateIdea: async (id, updates) => {
    try {
      const updated = await devApi.updateIdea(id, updates);
      set((state) => ({
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update idea", set);
    }
  },

  deleteIdea: async (id) => {
    try {
      await devApi.deleteIdea(id);
      set((state) => ({
        ideas: state.ideas.filter((i) => i.id !== id),
        triageItems: state.triageItems.filter((i) => i.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete idea", set);
    }
  },

  bulkDeleteIdeas: async (ids) => {
    try {
      const count = await devApi.bulkDeleteIdeas(ids);
      const idSet = new Set(ids);
      set((state) => ({
        ideas: state.ideas.filter((i) => !idSet.has(i.id)),
        triageItems: state.triageItems.filter((i) => !idSet.has(i.id)),
        error: null,
      }));
      return count;
    } catch (err) {
      reportError(err, "Failed to bulk delete ideas", set);
      throw err;
    }
  },
});
