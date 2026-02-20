import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type {
  OverviewTab,
  GlobalExecution,
  ManualReviewItem,
} from "@/lib/types/types";
import { enrichWithPersona } from "@/lib/types/types";
import * as api from "@/api/tauriApi";

export interface OverviewSlice {
  // State
  overviewTab: OverviewTab;
  globalExecutions: GlobalExecution[];
  globalExecutionsTotal: number;
  globalExecutionsOffset: number;
  manualReviews: ManualReviewItem[];
  manualReviewsTotal: number;
  pendingReviewCount: number;

  // Actions
  setOverviewTab: (tab: OverviewTab) => void;
  fetchGlobalExecutions: (reset?: boolean, status?: string) => Promise<void>;
  fetchManualReviews: (status?: string) => Promise<void>;
  updateManualReview: (id: string, updates: { status?: string; reviewer_notes?: string }) => Promise<void>;
  fetchPendingReviewCount: () => Promise<void>;
}

export const createOverviewSlice: StateCreator<PersonaStore, [], [], OverviewSlice> = (set, get) => ({
  overviewTab: "system-check" as OverviewTab,
  globalExecutions: [],
  globalExecutionsTotal: 0,
  globalExecutionsOffset: 0,
  manualReviews: [],
  manualReviewsTotal: 0,
  pendingReviewCount: 0,

  setOverviewTab: (tab) => set({ overviewTab: tab }),

  fetchGlobalExecutions: async (reset = false) => {
    try {
      // Aggregate executions across all personas
      const { personas } = get();
      const allExecs = await Promise.all(
        personas.map(async (p) => {
          try {
            const execs = await api.listExecutions(p.id, 10);
            return enrichWithPersona(execs, [p]);
          } catch {
            return [];
          }
        }),
      );
      const merged = allExecs
        .flat()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 50);
      if (reset) {
        set({
          globalExecutions: merged,
          globalExecutionsTotal: merged.length,
          globalExecutionsOffset: merged.length,
        });
      } else {
        set({
          globalExecutions: merged,
          globalExecutionsTotal: merged.length,
          globalExecutionsOffset: merged.length,
        });
      }
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch global executions") });
    }
  },

  fetchManualReviews: async (status?: string) => {
    try {
      const raw = await api.listManualReviews(undefined, status);
      const { personas } = get();
      const shaped = raw.map((r) => ({
        id: r.id,
        persona_id: r.persona_id,
        execution_id: r.execution_id,
        review_type: r.severity,
        content: r.title + (r.description ? `\n${r.description}` : ''),
        severity: r.severity,
        status: r.status,
        reviewer_notes: r.reviewer_notes,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
      }));
      const items: ManualReviewItem[] = enrichWithPersona(shaped, personas);
      const pendingCount = await api.getPendingReviewCount();
      set({ manualReviews: items, manualReviewsTotal: items.length, pendingReviewCount: pendingCount });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch manual reviews") });
    }
  },

  updateManualReview: async (id, updates) => {
    try {
      await api.updateManualReviewStatus(id, updates.status ?? 'pending', updates.reviewer_notes);
      // Re-fetch to get updated list
      await get().fetchManualReviews();
    } catch (err) {
      set({ error: errMsg(err, "Failed to update manual review") });
    }
  },

  fetchPendingReviewCount: async () => {
    try {
      const count = await api.getPendingReviewCount();
      set({ pendingReviewCount: count });
    } catch {
      set({ pendingReviewCount: 0 });
    }
  },
});
