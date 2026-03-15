import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { DevContextGroup } from "@/lib/bindings/DevContextGroup";
import type { DevContext } from "@/lib/bindings/DevContext";
import type { DevContextGroupRelationship } from "@/lib/bindings/DevContextGroupRelationship";
import * as devApi from "@/api/devTools/devTools";

export interface DevToolsContextSlice {
  // -- Context Map -----------------------------------------------------
  contextGroups: DevContextGroup[];
  contexts: DevContext[];
  contextGroupRelationships: DevContextGroupRelationship[];
  contextMapLoading: boolean;
  codebaseScanPhase: "idle" | "scanning" | "complete" | "error";
  activeScanId: string | null;

  fetchContextGroups: (projectId: string) => Promise<void>;
  createContextGroup: (projectId: string, name: string, color: string, icon?: string, groupType?: string) => Promise<DevContextGroup>;
  updateContextGroup: (id: string, updates: { name?: string; color?: string; icon?: string; groupType?: string; healthScore?: number }) => Promise<void>;
  deleteContextGroup: (id: string) => Promise<void>;
  reorderContextGroups: (projectId: string, groupIds: string[]) => Promise<void>;

  fetchContexts: (projectId: string, groupId?: string) => Promise<void>;
  createContext: (projectId: string, name: string, filePaths: string, groupId?: string, description?: string) => Promise<DevContext>;
  updateContext: (id: string, updates: { name?: string; description?: string; filePaths?: string; entryPoints?: string; dbTables?: string; keywords?: string; apiSurface?: string; crossRefs?: string; techStack?: string; groupId?: string }) => Promise<void>;
  deleteContext: (id: string) => Promise<void>;
  moveContext: (id: string, targetGroupId: string | null) => Promise<void>;
  scanCodebase: (projectId: string, rootPath: string) => Promise<void>;
  generateContextDescription: (contextId: string) => Promise<DevContext>;

  fetchContextGroupRelationships: (projectId: string) => Promise<void>;
  createContextGroupRelationship: (projectId: string, sourceGroupId: string, targetGroupId: string) => Promise<DevContextGroupRelationship>;
  deleteContextGroupRelationship: (id: string) => Promise<void>;
}

export const createDevToolsContextSlice: StateCreator<SystemStore, [], [], DevToolsContextSlice> = (set, get) => ({
  // -- Context Map state -----------------------------------------------
  contextGroups: [],
  contexts: [],
  contextGroupRelationships: [],
  contextMapLoading: false,
  codebaseScanPhase: "idle",
  activeScanId: null,

  fetchContextGroups: async (projectId) => {
    set({ contextMapLoading: true });
    try {
      const contextGroups = await devApi.listContextGroups(projectId);
      set({ contextGroups, contextMapLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch context groups", set, { stateUpdates: { contextMapLoading: false } });
    }
  },

  createContextGroup: async (projectId, name, color, icon, groupType) => {
    try {
      const group = await devApi.createContextGroup(projectId, name, color, icon, groupType);
      set((state) => ({ contextGroups: [...state.contextGroups, group], error: null }));
      return group;
    } catch (err) {
      reportError(err, "Failed to create context group", set);
      throw err;
    }
  },

  updateContextGroup: async (id, updates) => {
    try {
      const updated = await devApi.updateContextGroup(id, updates);
      set((state) => ({
        contextGroups: state.contextGroups.map((g) => (g.id === id ? updated : g)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update context group", set);
    }
  },

  deleteContextGroup: async (id) => {
    try {
      await devApi.deleteContextGroup(id);
      set((state) => ({
        contextGroups: state.contextGroups.filter((g) => g.id !== id),
        contexts: state.contexts.map((c) =>
          c.group_id === id ? { ...c, group_id: null } : c,
        ),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete context group", set);
    }
  },

  reorderContextGroups: async (projectId, groupIds) => {
    try {
      await devApi.reorderContextGroups(projectId, groupIds);
      await get().fetchContextGroups(projectId);
    } catch (err) {
      reportError(err, "Failed to reorder context groups", set);
    }
  },

  fetchContexts: async (projectId, groupId) => {
    set({ contextMapLoading: true });
    try {
      const contexts = await devApi.listContexts(projectId, groupId);
      set({ contexts, contextMapLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch contexts", set, { stateUpdates: { contextMapLoading: false } });
    }
  },

  createContext: async (projectId, name, filePaths, groupId, description) => {
    try {
      const ctx = await devApi.createContext(projectId, name, filePaths, groupId, description);
      set((state) => ({ contexts: [...state.contexts, ctx], error: null }));
      return ctx;
    } catch (err) {
      reportError(err, "Failed to create context", set);
      throw err;
    }
  },

  updateContext: async (id, updates) => {
    try {
      const updated = await devApi.updateContext(id, updates);
      set((state) => ({
        contexts: state.contexts.map((c) => (c.id === id ? updated : c)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update context", set);
    }
  },

  deleteContext: async (id) => {
    try {
      await devApi.deleteContext(id);
      set((state) => ({
        contexts: state.contexts.filter((c) => c.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete context", set);
    }
  },

  moveContext: async (id, targetGroupId) => {
    try {
      const updated = await devApi.moveContext(id, targetGroupId);
      set((state) => ({
        contexts: state.contexts.map((c) => (c.id === id ? updated : c)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to move context", set);
    }
  },

  scanCodebase: async (projectId, rootPath) => {
    set({ codebaseScanPhase: "scanning" });
    try {
      const result = await devApi.scanCodebase(projectId, rootPath);
      // The scan runs asynchronously via CLI — the scan_id is returned immediately.
      // Progress streams via "context-gen-output" Tauri events.
      // When complete, "context-gen-complete" fires and the UI should re-fetch.
      set({ activeScanId: (result as { scan_id: string }).scan_id, error: null });
    } catch (err) {
      reportError(err, "Failed to start codebase scan", set, { stateUpdates: { codebaseScanPhase: "error" } });
    }
  },

  generateContextDescription: async (contextId) => {
    try {
      const updated = await devApi.generateContextDescription(contextId);
      set((state) => ({
        contexts: state.contexts.map((c) => (c.id === contextId ? updated : c)),
        error: null,
      }));
      return updated;
    } catch (err) {
      reportError(err, "Failed to generate context description", set);
      throw err;
    }
  },

  fetchContextGroupRelationships: async (projectId) => {
    try {
      const contextGroupRelationships = await devApi.listContextGroupRelationships(projectId);
      set({ contextGroupRelationships, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch context group relationships", set);
    }
  },

  createContextGroupRelationship: async (projectId, sourceGroupId, targetGroupId) => {
    try {
      const rel = await devApi.createContextGroupRelationship(projectId, sourceGroupId, targetGroupId);
      set((state) => ({ contextGroupRelationships: [...state.contextGroupRelationships, rel], error: null }));
      return rel;
    } catch (err) {
      reportError(err, "Failed to create context group relationship", set);
      throw err;
    }
  },

  deleteContextGroupRelationship: async (id) => {
    try {
      await devApi.deleteContextGroupRelationship(id);
      set((state) => ({
        contextGroupRelationships: state.contextGroupRelationships.filter((r) => r.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete context group relationship", set);
    }
  },
});
