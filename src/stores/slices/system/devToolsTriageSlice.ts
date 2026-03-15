import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { DevIdea } from "@/lib/bindings/DevIdea";
import type { TriageRule } from "@/lib/bindings/TriageRule";
import * as devApi from "@/api/devTools/devTools";

export interface DevToolsTriageSlice {
  // -- Triage ----------------------------------------------------------
  triageItems: DevIdea[];
  triageCursor: string | null;
  triageHasMore: boolean;
  triageCounts: { total: number; pending: number; accepted: number; rejected: number } | null;
  triageFilterCategory: string | null;
  triageFilterScanType: string | null;

  fetchTriageIdeas: (projectId: string, limit?: number) => Promise<void>;
  fetchMoreTriageIdeas: (projectId: string, limit?: number) => Promise<void>;
  acceptIdea: (id: string) => Promise<void>;
  rejectIdea: (id: string, reason?: string) => Promise<void>;
  deleteTriageIdea: (id: string) => Promise<void>;
  setTriageFilterCategory: (category: string | null) => void;
  setTriageFilterScanType: (scanType: string | null) => void;

  // -- Triage Rules ----------------------------------------------------
  triageRules: TriageRule[];

  fetchTriageRules: (projectId?: string) => Promise<void>;
  createTriageRule: (name: string, conditions: string, action: string, projectId?: string) => Promise<TriageRule>;
  updateTriageRule: (id: string, updates: { name?: string; conditions?: string; action?: string; enabled?: boolean }) => Promise<void>;
  deleteTriageRule: (id: string) => Promise<void>;
  runTriageRules: (projectId: string) => Promise<{ applied: number; ideas_affected: number }>;
}

export const createDevToolsTriageSlice: StateCreator<SystemStore, [], [], DevToolsTriageSlice> = (set, get) => ({
  // -- Triage state ----------------------------------------------------
  triageItems: [],
  triageCursor: null,
  triageHasMore: false,
  triageCounts: null,
  triageFilterCategory: null,
  triageFilterScanType: null,

  fetchTriageIdeas: async (projectId, limit) => {
    try {
      const result = await devApi.triageIdeas(projectId, limit);
      set({
        triageItems: result.ideas,
        triageCursor: result.cursor,
        triageHasMore: result.has_more,
        triageCounts: result.counts,
        error: null,
      });
    } catch (err) {
      reportError(err, "Failed to fetch triage ideas", set);
    }
  },

  fetchMoreTriageIdeas: async (projectId, limit) => {
    const { triageCursor } = get();
    if (!triageCursor) return;
    try {
      const result = await devApi.triageIdeas(projectId, limit, triageCursor);
      set((state) => ({
        triageItems: [...state.triageItems, ...result.ideas],
        triageCursor: result.cursor,
        triageHasMore: result.has_more,
        triageCounts: result.counts,
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to fetch more triage ideas", set);
    }
  },

  acceptIdea: async (id) => {
    try {
      const updated = await devApi.acceptIdea(id);
      set((state) => ({
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        triageCounts: state.triageCounts
          ? { ...state.triageCounts, pending: state.triageCounts.pending - 1, accepted: state.triageCounts.accepted + 1 }
          : null,
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to accept idea", set);
    }
  },

  rejectIdea: async (id, reason) => {
    try {
      const updated = await devApi.rejectIdea(id, reason);
      set((state) => ({
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        triageCounts: state.triageCounts
          ? { ...state.triageCounts, pending: state.triageCounts.pending - 1, rejected: state.triageCounts.rejected + 1 }
          : null,
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to reject idea", set);
    }
  },

  deleteTriageIdea: async (id) => {
    try {
      await devApi.deleteTriageIdea(id);
      set((state) => ({
        triageItems: state.triageItems.filter((i) => i.id !== id),
        triageCounts: state.triageCounts
          ? { ...state.triageCounts, total: state.triageCounts.total - 1, pending: state.triageCounts.pending - 1 }
          : null,
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete triage idea", set);
    }
  },

  setTriageFilterCategory: (category) => {
    set({ triageFilterCategory: category });
  },

  setTriageFilterScanType: (scanType) => {
    set({ triageFilterScanType: scanType });
  },

  // -- Triage Rules state ----------------------------------------------
  triageRules: [],

  fetchTriageRules: async (projectId) => {
    try {
      const triageRules = await devApi.listTriageRules(projectId);
      set({ triageRules, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch triage rules", set);
    }
  },

  createTriageRule: async (name, conditions, action, projectId) => {
    try {
      const rule = await devApi.createTriageRule(name, conditions, action, projectId);
      set((state) => ({ triageRules: [...state.triageRules, rule], error: null }));
      return rule;
    } catch (err) {
      reportError(err, "Failed to create triage rule", set);
      throw err;
    }
  },

  updateTriageRule: async (id, updates) => {
    try {
      const updated = await devApi.updateTriageRule(id, updates);
      set((state) => ({
        triageRules: state.triageRules.map((r) => (r.id === id ? updated : r)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update triage rule", set);
    }
  },

  deleteTriageRule: async (id) => {
    try {
      await devApi.deleteTriageRule(id);
      set((state) => ({
        triageRules: state.triageRules.filter((r) => r.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete triage rule", set);
    }
  },

  runTriageRules: async (projectId) => {
    try {
      const result = await devApi.runTriageRules(projectId);
      // Re-fetch triage items to reflect changes
      await get().fetchTriageIdeas(projectId);
      return result;
    } catch (err) {
      reportError(err, "Failed to run triage rules", set);
      throw err;
    }
  },
});
