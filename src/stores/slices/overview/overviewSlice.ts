import { startTransition } from "react";
import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type {
  OverviewTab,
  GlobalExecution,
  ManualReviewItem,
} from "@/lib/types/types";
import type { ManualReviewStatus } from "@/lib/bindings/ManualReviewStatus";
import type { ObservabilityMetrics } from "@/lib/bindings/ObservabilityMetrics";
import type { ExecutionDashboardData } from "@/lib/bindings/ExecutionDashboardData";
import type { MetricsChartPoint } from "@/lib/bindings/MetricsChartPoint";
import { listAllExecutions } from "@/api/agents/executions";
import { getExecutionDashboard, getMetricsChartData, getMetricsSummary } from "@/api/overview/observability";
import { getPendingReviewCount, listManualReviews, updateManualReviewStatus } from "@/api/overview/reviews";

import { cloudListPendingReviews, cloudRespondToReview } from "@/api/system/cloud";
import { log } from "@/lib/log";
import { classifyError, ApiError, withRetry } from "@/lib/utils/apiError";
import { deduplicateFetch } from "@/lib/utils/deduplicateFetch";
import { measureStoreAction } from "@/lib/utils/storePerf";
import { sanitizeCloudReview } from "@/lib/utils/sanitizers/sanitizeCloudReview";

export interface OverviewSlice {
  // State -- navigation
  overviewTab: OverviewTab;

  // State -- executions
  globalExecutions: GlobalExecution[];
  globalExecutionsTotal: number;
  globalExecutionsOffset: number;
  globalExecutionsWarning: string | null;
  globalExecutionsLimit: number;

  // State -- reviews (local)
  manualReviews: ManualReviewItem[];
  manualReviewsTotal: number;
  pendingReviewCount: number;

  // State -- reviews (cloud)
  cloudReviews: ManualReviewItem[];
  isLoadingCloudReviews: boolean;

  // State -- observability metrics
  observabilityMetrics: ObservabilityMetrics | null;
  observabilityError: string | null;

  // State -- execution dashboard (canonical metrics source)
  executionDashboard: ExecutionDashboardData | null;
  executionDashboardDays: number | null;
  executionDashboardLoading: boolean;
  executionDashboardError: string | null;

  // State -- per-source pipeline errors (set when individual dashboard fetches fail)
  pipelineErrors: Record<string, string>;

  // State -- per-source last-successful-fetch timestamps (epoch ms)
  pipelineFetchedAt: Record<string, number>;

  // Actions
  setOverviewTab: (tab: OverviewTab) => void;
  setPipelineError: (source: string, error: string | null) => void;
  setPipelineFetchedAt: (source: string) => void;
  clearPipelineErrors: () => void;
  fetchGlobalExecutions: (reset?: boolean, status?: string, personaId?: string) => Promise<void>;
  fetchManualReviews: (status?: string) => Promise<void>;
  updateManualReview: (id: string, updates: { status?: ManualReviewStatus; reviewer_notes?: string }) => Promise<void>;
  fetchPendingReviewCount: () => Promise<void>;
  fetchCloudReviews: () => Promise<void>;
  respondToCloudReview: (reviewId: string, executionId: string, decision: string, message: string) => Promise<void>;
  fetchObservabilityMetrics: (days?: number, personaId?: string) => Promise<void>;
  fetchExecutionDashboard: (days?: number) => Promise<void>;
}

// -- Execution dashboard derivation --------------------------------------
/** Derive MetricsChartPoint[] from the richer DashboardDailyPoint[]. */
export function selectDerivedChartPoints(data: ExecutionDashboardData | null): MetricsChartPoint[] {
  if (!data) return [];
  return data.daily_points.map((pt) => ({
    date: pt.date,
    cost: pt.total_cost,
    executions: pt.total_executions,
    success: pt.completed,
    failed: pt.failed,
    tokens: pt.total_tokens,
    active_personas: pt.persona_costs.length,
  }));
}

/** Safely convert a Unix timestamp (seconds or milliseconds) to ISO string.
 *  Returns null if the value is missing or invalid (before year 2000). */
function safeTimestampToISO(value: number | null | undefined): string | null {
  if (value == null || value === 0) return null;
  // If > 1e12, assume milliseconds; otherwise assume seconds
  const ms = value > 1e12 ? value : value * 1000;
  // Reject dates before 2000-01-01 as invalid
  if (ms < 946684800000) return null;
  return new Date(ms).toISOString();
}

// Server-side pagination constants.
const GLOBAL_PAGE_SIZE = 50;
const MAX_GLOBAL_LIMIT = 500;

/** Sequence counter to discard stale fetchGlobalExecutions responses. */
let fetchGlobalSeq = 0;

export const createOverviewSlice: StateCreator<OverviewStore, [], [], OverviewSlice> = (set, get) => ({
  overviewTab: "home" as OverviewTab,
  globalExecutions: [],
  globalExecutionsTotal: 0,
  globalExecutionsOffset: 0,
  globalExecutionsWarning: null,
  globalExecutionsLimit: GLOBAL_PAGE_SIZE,
  manualReviews: [],
  manualReviewsTotal: 0,
  pendingReviewCount: 0,
  cloudReviews: [],
  isLoadingCloudReviews: false,
  observabilityMetrics: null,
  observabilityError: null,
  executionDashboard: null,
  executionDashboardDays: null,
  executionDashboardLoading: false,
  executionDashboardError: null,
  pipelineErrors: {},
  pipelineFetchedAt: {},

  setOverviewTab: (tab) => startTransition(() => set({ overviewTab: tab })),
  setPipelineError: (source, error) => set((prev) => {
    const next = { ...prev.pipelineErrors };
    if (error) next[source] = error;
    else delete next[source];
    return { pipelineErrors: next };
  }),
  setPipelineFetchedAt: (source) => set((prev) => ({
    pipelineFetchedAt: { ...prev.pipelineFetchedAt, [source]: Date.now() },
  })),
  clearPipelineErrors: () => set({ pipelineErrors: {} }),

  fetchGlobalExecutions: async (reset = false, status?: string, personaId?: string) => {
    const seq = ++fetchGlobalSeq;
    try {
      const prevLimit = get().globalExecutionsLimit;
      const limit = reset
        ? GLOBAL_PAGE_SIZE
        : Math.min(prevLimit + GLOBAL_PAGE_SIZE, MAX_GLOBAL_LIMIT);
      set({ globalExecutionsLimit: limit });

      const statusFilter = status === 'running' ? 'running' : status;
      const rows = await listAllExecutions(limit, statusFilter, personaId);

      if (seq !== fetchGlobalSeq) return; // superseded by a newer request

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

      // Use raw row count (before dedup) for hasMore so duplicates don't
      // trick the heuristic into hiding the Load More button prematurely.
      const rawCount = rows.length;
      set({
        globalExecutions: merged,
        globalExecutionsTotal: merged.length + (rawCount >= limit ? 1 : 0),
        globalExecutionsOffset: merged.length,
        globalExecutionsWarning: null,
      });
    } catch (err) {
      if (seq !== fetchGlobalSeq) return; // superseded by a newer request
      reportError(err, "Failed to fetch global executions", set);
    }
  },

  fetchManualReviews: async (status?: string) => {
    try {
      const [raw, pendingCount] = await Promise.all([
        listManualReviews(undefined, status),
        getPendingReviewCount(),
      ]);
      const shaped: ManualReviewItem[] = raw.map((r) => ({
        id: r.id,
        persona_id: r.persona_id,
        execution_id: r.execution_id,
        review_type: r.severity,
        content: r.title + (r.description ? `\n${r.description}` : ''),
        severity: r.severity,
        status: r.status,
        reviewer_notes: r.reviewer_notes,
        context_data: r.context_data,
        suggested_actions: r.suggested_actions,
        title: r.title,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
      }));
      set({ manualReviews: shaped, manualReviewsTotal: shaped.length, pendingReviewCount: pendingCount });
    } catch (err) {
      reportError(err, "Failed to fetch manual reviews", set);
    }
  },

  updateManualReview: async (id, updates) => {
    try {
      await updateManualReviewStatus(id, updates.status ?? 'pending', updates.reviewer_notes);
      // Re-fetch to get updated list
      await get().fetchManualReviews();
    } catch (err) {
      reportError(err, "Failed to update manual review", set);
    }
  },

  fetchPendingReviewCount: deduplicateFetch('pendingReviewCount', async () => {
    try {
      const count = await getPendingReviewCount();
      set({ pendingReviewCount: count });
    } catch (err) {
      log.warn('overviewSlice', 'fetchPendingReviewCount failed, defaulting to 0', { operation: 'getPendingReviewCount', error: String(err) });
      set({ pendingReviewCount: 0 });
    }
  }),

  fetchCloudReviews: async () => {
    const cloudConfig = storeBus.get<{ is_connected?: boolean } | null>(AccessorKey.SYSTEM_CLOUD_CONFIG);
    if (!cloudConfig?.is_connected) {
      set({ cloudReviews: [] });
      return;
    }
    set({ isLoadingCloudReviews: true });
    try {
      const raw = await cloudListPendingReviews();
      // Transform CloudReviewRequest -> ManualReviewItem shape
      // Sanitize at the trust boundary: cloud payloads are external input.
      const shaped: ManualReviewItem[] = raw.map((r) => {
        const sanitized = sanitizeCloudReview(r.payload, r.response_message);
        return {
          id: r.review_id,
          persona_id: r.persona_id,
          execution_id: r.execution_id,
          review_type: 'info',
          content: sanitized.content,
          severity: 'info',
          status: r.status === 'pending' ? 'pending' : r.status,
          reviewer_notes: sanitized.reviewerNotes,
          context_data: null,
          suggested_actions: null,
          title: sanitized.title,
          created_at: safeTimestampToISO(r.created_at) ?? new Date().toISOString(),
          resolved_at: safeTimestampToISO(r.resolved_at),
          source: 'cloud' as const,
        };
      });
      set({ cloudReviews: shaped, isLoadingCloudReviews: false });
    } catch (err) {
      log.warn('overviewSlice', 'fetchCloudReviews failed, falling back to empty', { operation: 'cloudListPendingReviews', error: String(err) });
      set({ cloudReviews: [], isLoadingCloudReviews: false });
    }
  },

  respondToCloudReview: async (reviewId, executionId, decision, message) => {
    try {
      await cloudRespondToReview(executionId, reviewId, decision, message);
      // Re-fetch cloud reviews to reflect the update
      await get().fetchCloudReviews();
    } catch (err) {
      reportError(err, "Failed to respond to cloud review", set);
    }
  },

  fetchObservabilityMetrics: async (days = 30, personaId?: string) => {
    try {
      // When no persona filter is active, derive the summary from the
      // execution dashboard (already loaded) to avoid a redundant SQL scan.
      const dashboard = get().executionDashboard;
      const canReuseDashboard = !personaId && dashboard && get().executionDashboardDays === days;

      const [summary, chartData] = await withRetry(
        () => Promise.all([
          canReuseDashboard
            ? Promise.resolve({
                totalExecutions: dashboard.total_executions,
                successfulExecutions: dashboard.successful_executions,
                failedExecutions: dashboard.failed_executions,
                totalCostUsd: dashboard.total_cost,
                activePersonas: dashboard.active_personas,
                periodDays: days,
              })
            : getMetricsSummary(days, personaId),
          getMetricsChartData(days, personaId),
        ]),
        "Failed to load observability metrics",
      );
      set({ observabilityMetrics: { summary, chartData }, observabilityError: null });
    } catch (err) {
      const classified = err instanceof ApiError ? err : classifyError(err, "Failed to load observability metrics");
      const prefix = classified.isTransient ? '[Temporary] ' : '';
      set({ observabilityError: prefix + classified.message });
      if (classified.isTransient) {
        log.warn('overviewSlice', 'Transient error fetching observability metrics (retries exhausted)', { error: classified.message });
      }
    }
  },

  fetchExecutionDashboard: async (days = 30) => {
    set({ executionDashboardLoading: true });
    try {
      const data = await measureStoreAction('fetchExecutionDashboard', () =>
        withRetry(
          () => getExecutionDashboard(days),
          "Failed to load execution dashboard",
        ),
      );
      set({ executionDashboard: data, executionDashboardDays: days, executionDashboardError: null, executionDashboardLoading: false });
    } catch (err) {
      const classified = err instanceof ApiError ? err : classifyError(err, "Failed to load execution dashboard");
      const prefix = classified.isTransient ? '[Temporary] ' : '';
      set({ executionDashboardError: prefix + classified.message, executionDashboardLoading: false });
    }
  },
});
