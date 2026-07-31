import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { DevIdea } from "@/lib/bindings/DevIdea";
import type { TriageCounts } from "@/lib/bindings/TriageCounts";
import type { TriageRule } from "@/lib/bindings/TriageRule";
import * as devApi from "@/api/devTools/devTools";
import { decideIdeaRow } from "@/lib/decisions/rowWrites";

/**
 * Server-side narrowing for a triage page. `projectId` is a separate argument
 * because omitting it is meaningful (cross-project read — the unified Backlog
 * default), not just "no filter".
 */
export interface TriageQuery {
  limit?: number;
  /** Backend defaults to `pending`. */
  status?: string;
  /** `scanner` is the pseudo-origin for classic scanner ideas (`origin IS NULL`). */
  origin?: string;
  category?: string;
}

/** Move one idea between status buckets without disturbing the facet counts. */
function shiftCounts(
  counts: TriageCounts | null,
  from: string | undefined,
  to: keyof TriageCounts | null,
): TriageCounts | null {
  if (!counts) return null;
  const next = { ...counts };
  if (from && from in next && typeof next[from as keyof TriageCounts] === "number") {
    (next[from as "pending"] as number) = Math.max(0, next[from as "pending"] - 1);
  }
  if (to && typeof next[to] === "number") {
    (next[to as "accepted"] as number) = next[to as "accepted"] + 1;
  }
  return next;
}

export interface DevToolsTriageSlice {
  // -- Triage ----------------------------------------------------------
  triageItems: DevIdea[];
  triageCursor: string | null;
  triageHasMore: boolean;
  triageCounts: TriageCounts | null;
  /** True while a first page (or a reload) is in flight. */
  triageLoading: boolean;
  /** True while a keyset continuation is in flight. */
  triageLoadingMore: boolean;
  triageFilterCategory: string | null;
  triageFilterScanType: string | null;

  /** `projectId` undefined = cross-project (the unified Backlog default). */
  fetchTriageIdeas: (projectId?: string, query?: TriageQuery) => Promise<void>;
  fetchMoreTriageIdeas: (projectId?: string, query?: TriageQuery) => Promise<void>;
  /**
   * THE door for an idea verdict. Every surface that decides a backlog idea —
   * the Backlog table, the triage deck, the dev-tools panel — goes through here
   * so the row, the facet counts and the error handling move together.
   *
   * `seenStatus` is the status the CALLING SURFACE rendered. It becomes the
   * backend's compare-and-swap expectation, so a verdict written against a card
   * someone else already decided loses loudly instead of overwriting them.
   * Defaults to whatever this slice holds for the row.
   *
   * REJECTS on failure (in addition to the toast) so an optimistic caller can
   * put the row back.
   */
  acceptIdea: (id: string, seenStatus?: string) => Promise<void>;
  rejectIdea: (id: string, reason?: string, seenStatus?: string) => Promise<void>;
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
  triageLoading: false,
  triageLoadingMore: false,
  triageFilterCategory: null,
  triageFilterScanType: null,

  fetchTriageIdeas: async (projectId, query) => {
    set({ triageLoading: true });
    try {
      const result = await devApi.triageIdeas(projectId, query?.limit, undefined, {
        status: query?.status,
        origin: query?.origin,
        category: query?.category,
      });
      set({
        triageItems: result.ideas,
        triageCursor: result.cursor,
        triageHasMore: result.hasMore,
        triageCounts: result.counts,
        error: null,
      });
    } catch (err) {
      reportError(err, "Failed to fetch triage ideas", set);
    } finally {
      set({ triageLoading: false });
    }
  },

  fetchMoreTriageIdeas: async (projectId, query) => {
    const { triageCursor, triageLoadingMore } = get();
    if (!triageCursor || triageLoadingMore) return;
    set({ triageLoadingMore: true });
    try {
      const result = await devApi.triageIdeas(projectId, query?.limit, triageCursor, {
        status: query?.status,
        origin: query?.origin,
        category: query?.category,
      });
      set((state) => ({
        // De-dupe on id: a row inserted between two keyset reads can otherwise
        // arrive on both pages and React would see duplicate keys.
        triageItems: [
          ...state.triageItems,
          ...result.ideas.filter((i) => !state.triageItems.some((e) => e.id === i.id)),
        ],
        triageCursor: result.cursor,
        triageHasMore: result.hasMore,
        triageCounts: result.counts,
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to fetch more triage ideas", set);
    } finally {
      set({ triageLoadingMore: false });
    }
  },

  acceptIdea: async (id, seenStatus) => {
    const from = seenStatus ?? get().triageItems.find((i) => i.id === id)?.status ?? "pending";
    try {
      const updated = await decideIdeaRow(id, "accept", { seenStatus: from });
      set((state) => ({
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        // Decrement the bucket the row ACTUALLY left — accepting an already
        // rejected/archived row must not drive `pending` negative.
        triageCounts: shiftCounts(state.triageCounts, from, "accepted"),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to accept idea", set);
      // Rethrow: this used to swallow, so the triage deck (which resolves the
      // card the moment it decides) had nothing to restore from and every
      // failure looked like a completed decision.
      throw err;
    }
  },

  rejectIdea: async (id, reason, seenStatus) => {
    const from = seenStatus ?? get().triageItems.find((i) => i.id === id)?.status ?? "pending";
    try {
      const updated = await decideIdeaRow(id, "reject", { seenStatus: from, reason });
      set((state) => ({
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        triageCounts: shiftCounts(state.triageCounts, from, "rejected"),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to reject idea", set);
      throw err;
    }
  },

  deleteTriageIdea: async (id) => {
    try {
      await devApi.deleteTriageIdea(id);
      set((state) => {
        const gone = state.triageItems.find((i) => i.id === id);
        const shifted = shiftCounts(state.triageCounts, gone?.status ?? "pending", null);
        return {
          triageItems: state.triageItems.filter((i) => i.id !== id),
          triageCounts: shifted ? { ...shifted, total: Math.max(0, shifted.total - 1) } : null,
          error: null,
        };
      });
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
