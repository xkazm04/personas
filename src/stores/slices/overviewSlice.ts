import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type {
  OverviewTab,
  GlobalExecution,
  ManualReviewItem,
} from "@/lib/types/types";
import { enrichWithPersona } from "@/lib/types/types";
import type { ObservabilityMetrics } from "@/lib/bindings/ObservabilityMetrics";
import type { ExecutionDashboardData } from "@/lib/bindings/ExecutionDashboardData";
import type { MetricsChartPoint } from "@/lib/bindings/MetricsChartPoint";
import * as api from "@/api/tauriApi";
import { cloudListPendingReviews, cloudRespondToReview } from "@/api/cloud";

export interface OverviewSlice {
  // State — navigation
  overviewTab: OverviewTab;

  // State — executions
  globalExecutions: GlobalExecution[];
  globalExecutionsTotal: number;
  globalExecutionsOffset: number;
  globalExecutionsWarning: string | null;

  // State — reviews (local)
  manualReviews: ManualReviewItem[];
  manualReviewsTotal: number;
  pendingReviewCount: number;

  // State — reviews (cloud)
  cloudReviews: ManualReviewItem[];
  isLoadingCloudReviews: boolean;

  // State — observability metrics
  observabilityMetrics: ObservabilityMetrics | null;
  observabilityError: string | null;

  // State — execution dashboard (canonical metrics source)
  executionDashboard: ExecutionDashboardData | null;
  executionDashboardLoading: boolean;
  executionDashboardError: string | null;

  // Actions
  setOverviewTab: (tab: OverviewTab) => void;
  fetchGlobalExecutions: (reset?: boolean, status?: string) => Promise<void>;
  fetchManualReviews: (status?: string) => Promise<void>;
  updateManualReview: (id: string, updates: { status?: string; reviewer_notes?: string }) => Promise<void>;
  fetchPendingReviewCount: () => Promise<void>;
  fetchCloudReviews: () => Promise<void>;
  respondToCloudReview: (reviewId: string, executionId: string, decision: string, message: string) => Promise<void>;
  fetchObservabilityMetrics: (days?: number, personaId?: string) => Promise<void>;
  fetchExecutionDashboard: (days?: number) => Promise<void>;
}

// ── Execution dashboard derivation ──────────────────────────────────────
/** Derive MetricsChartPoint[] from the richer DashboardDailyPoint[]. */
export function selectDerivedChartPoints(data: ExecutionDashboardData | null): MetricsChartPoint[] {
  if (!data) return [];
  return data.daily_points.map((pt) => ({
    date: pt.date,
    cost: pt.total_cost,
    executions: pt.total_executions,
    success: pt.completed,
    failed: pt.failed,
    tokens: 0,
    active_personas: pt.persona_costs.length,
  }));
}

// Server-side pagination: each "Load More" increases the global limit.
let currentGlobalLimit = 50;
const GLOBAL_PAGE_SIZE = 50;
const MAX_GLOBAL_LIMIT = 500;

export const createOverviewSlice: StateCreator<PersonaStore, [], [], OverviewSlice> = (set, get) => ({
  overviewTab: "home" as OverviewTab,
  globalExecutions: [],
  globalExecutionsTotal: 0,
  globalExecutionsOffset: 0,
  globalExecutionsWarning: null,
  manualReviews: [],
  manualReviewsTotal: 0,
  pendingReviewCount: 0,
  cloudReviews: [],
  isLoadingCloudReviews: false,
  observabilityMetrics: null,
  observabilityError: null,
  executionDashboard: null,
  executionDashboardLoading: false,
  executionDashboardError: null,

  setOverviewTab: (tab) => set({ overviewTab: tab }),

  fetchGlobalExecutions: async (reset = false, status?: string) => {
    try {
      if (reset) {
        currentGlobalLimit = GLOBAL_PAGE_SIZE;
      } else {
        currentGlobalLimit = Math.min(
          currentGlobalLimit + GLOBAL_PAGE_SIZE,
          MAX_GLOBAL_LIMIT,
        );
      }

      const statusFilter = status === 'running' ? 'running' : status;
      const rows = await api.listAllExecutions(currentGlobalLimit, statusFilter);

      // Map GlobalExecutionRow to GlobalExecution (field names already match)
      // Deduplicate by id to prevent React duplicate-key warnings
      const seen = new Set<string>();
      const merged: GlobalExecution[] = [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push({
          ...r,
          persona_name: r.persona_name ?? undefined,
          persona_icon: r.persona_icon ?? undefined,
          persona_color: r.persona_color ?? undefined,
        });
      }

      set({
        globalExecutions: merged,
        // Signal hasMore when result count equals the limit
        globalExecutionsTotal: merged.length + (merged.length >= currentGlobalLimit ? 1 : 0),
        globalExecutionsOffset: merged.length,
        globalExecutionsWarning: null,
      });
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
      // intentional: non-critical — badge count defaults to zero on failure
      set({ pendingReviewCount: 0 });
    }
  },

  fetchCloudReviews: async () => {
    const { cloudConfig } = get() as PersonaStore;
    if (!cloudConfig?.is_connected) {
      set({ cloudReviews: [] });
      return;
    }
    set({ isLoadingCloudReviews: true });
    try {
      const raw = await cloudListPendingReviews();
      const { personas } = get();
      // Transform CloudReviewRequest → ManualReviewItem shape
      const shaped = raw.map((r) => ({
        id: r.review_id,
        persona_id: r.persona_id,
        execution_id: r.execution_id,
        review_type: 'info',
        content: typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload ?? ''),
        severity: 'info',
        status: r.status === 'pending' ? 'pending' : r.status,
        reviewer_notes: r.response_message,
        created_at: r.created_at != null ? new Date(r.created_at * 1000).toISOString() : new Date().toISOString(),
        resolved_at: r.resolved_at != null ? new Date(r.resolved_at * 1000).toISOString() : null,
        source: 'cloud' as const,
      }));
      const items: ManualReviewItem[] = enrichWithPersona(shaped, personas);
      set({ cloudReviews: items, isLoadingCloudReviews: false });
    } catch {
      // Non-critical — cloud reviews fail silently, local reviews still work
      set({ cloudReviews: [], isLoadingCloudReviews: false });
    }
  },

  respondToCloudReview: async (reviewId, executionId, decision, message) => {
    try {
      await cloudRespondToReview(executionId, reviewId, decision, message);
      // Re-fetch cloud reviews to reflect the update
      await get().fetchCloudReviews();
    } catch (err) {
      set({ error: errMsg(err, "Failed to respond to cloud review") });
    }
  },

  fetchObservabilityMetrics: async (days = 30, personaId?: string) => {
    try {
      const [summary, chartData] = await Promise.all([
        api.getMetricsSummary(days, personaId),
        api.getMetricsChartData(days, personaId),
      ]);
      set({ observabilityMetrics: { summary, chartData }, observabilityError: null });
    } catch (err) {
      set({ observabilityError: errMsg(err, "Failed to load observability metrics") });
    }
  },

  fetchExecutionDashboard: async (days = 30) => {
    set({ executionDashboardLoading: true });
    try {
      const data = await api.getExecutionDashboard(days);
      set({ executionDashboard: data, executionDashboardError: null, executionDashboardLoading: false });
    } catch (err) {
      set({ executionDashboardError: errMsg(err, "Failed to load execution dashboard"), executionDashboardLoading: false });
    }
  },
});
