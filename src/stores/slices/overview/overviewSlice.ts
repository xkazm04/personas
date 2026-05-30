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
import { listAllExecutions, countExecutions } from "@/api/agents/executions";
import type { ExecutionCounts } from "@/lib/bindings/ExecutionCounts";
import { getExecutionDashboard, getOverviewBundle } from "@/api/overview/observability";
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
  /** Pagination hint, NOT a row count — `true` when the most recent fetch
   *  hit `globalExecutionsLimit`, suggesting there's more on the server. The
   *  authoritative total lives on `globalExecutionCounts.total`. Previously
   *  this field was a misnamed number `globalExecutionsTotal` set to
   *  `merged.length + (rawCount >= limit ? 1 : 0)` — looking like a row
   *  count but actually being a +1 sentinel; consumers wiring "X of Y" UIs
   *  silently displayed wrong numbers. Renamed and retyped as a boolean to
   *  make misuse a type error. */
  globalExecutionsHasMore: boolean;
  globalExecutionsOffset: number;
  globalExecutionsWarning: string | null;
  globalExecutionsLimit: number;
  /** Precise server-side counts for the Activity filter badges (total /
   *  running / completed / failed). Updated independently from the paged
   *  row list so the badges stay accurate regardless of what's loaded.
   *  This is the authoritative total — read `globalExecutionCounts.total`
   *  for any "N of M" display, not `globalExecutionsHasMore`. */
  globalExecutionCounts: ExecutionCounts;

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

  /** Cross-component focus signal for opening a specific execution's detail
   *  modal on Overview › Activity. Set by the NotificationCenter when the
   *  user clicks an execution notification; cleared by `GlobalExecutionList`
   *  once the modal is open so the same id doesn't re-trigger on remount. */
  pendingExecutionFocus: string | null;

  // Actions
  setOverviewTab: (tab: OverviewTab) => void;
  setPendingExecutionFocus: (executionId: string | null) => void;
  setPipelineError: (source: string, error: string | null) => void;
  /** Apply a whole wave of pipeline fetch outcomes in a single store write —
   *  one set() per wave instead of 2×N (setPipelineError + setPipelineFetchedAt
   *  per source). Sequential external-store mutations aren't batched like
   *  setState, so the per-source pair drove redundant re-renders of the
   *  dashboard's pipeline subscribers. Architect perf scan, Phase B. */
  applyPipelineResults: (results: ReadonlyArray<{ source: string; error: string | null }>) => void;
  clearPipelineErrors: () => void;
  fetchGlobalExecutions: (reset?: boolean, status?: string, personaId?: string) => Promise<void>;
  fetchGlobalExecutionCounts: (personaId?: string) => Promise<void>;
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
/** Sequence counter to discard stale fetchGlobalExecutionCounts responses.
 *  Without this, rapidly switching the persona filter could let an older
 *  count request resolve last and overwrite the badges with the previous
 *  persona's totals, even though the row list (guarded by fetchGlobalSeq)
 *  is correct. */
let fetchGlobalCountsSeq = 0;

export const createOverviewSlice: StateCreator<OverviewStore, [], [], OverviewSlice> = (set, get) => ({
  overviewTab: "home" as OverviewTab,
  globalExecutions: [],
  globalExecutionsHasMore: false,
  globalExecutionsOffset: 0,
  globalExecutionsWarning: null,
  globalExecutionsLimit: GLOBAL_PAGE_SIZE,
  globalExecutionCounts: { total: 0, running: 0, completed: 0, failed: 0 },
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
  pendingExecutionFocus: null,

  // Note: do NOT wrap this in startTransition. Sidebar nav clicks must be
  // a synchronous, deterministic state update — the OverviewPage uses
  // `key={overviewTab}` to remount lazy subtab chunks via Suspense, and a
  // deferred transition can be interrupted by higher-priority renders so
  // the content never swaps even though the sidebar highlight updated.
  setOverviewTab: (tab) => set({ overviewTab: tab }),
  setPendingExecutionFocus: (executionId) => set({ pendingExecutionFocus: executionId }),
  setPipelineError: (source, error) => set((prev) => {
    const next = { ...prev.pipelineErrors };
    if (error) next[source] = error;
    else delete next[source];
    return { pipelineErrors: next };
  }),
  applyPipelineResults: (results) => set((prev) => {
    const errors = { ...prev.pipelineErrors };
    const fetchedAt = { ...prev.pipelineFetchedAt };
    const now = Date.now();
    for (const { source, error } of results) {
      if (error) {
        errors[source] = error;
      } else {
        // Success: clear any prior error for this source and stamp fetch time.
        delete errors[source];
        fetchedAt[source] = now;
      }
    }
    return { pipelineErrors: errors, pipelineFetchedAt: fetchedAt };
  }),
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
          // Director verdict fields aren't part of the global JOIN row; the
          // per-persona Activity list (full PersonaExecution) carries them.
          director_score: null,
          director_review_md: null,
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
        globalExecutionsHasMore: rawCount >= limit,
        globalExecutionsOffset: merged.length,
        globalExecutionsWarning: null,
      });
    } catch (err) {
      if (seq !== fetchGlobalSeq) return; // superseded by a newer request
      reportError(err, "Failed to fetch global executions", set);
    }
  },

  fetchGlobalExecutionCounts: async (personaId?: string) => {
    const seq = ++fetchGlobalCountsSeq;
    try {
      const counts = await countExecutions(personaId);
      if (seq !== fetchGlobalCountsSeq) return; // superseded by a newer request
      set({ globalExecutionCounts: counts });
    } catch (err) {
      if (seq !== fetchGlobalCountsSeq) return; // superseded by a newer request
      log.warn('overviewSlice', 'fetchGlobalExecutionCounts failed', { error: String(err) });
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
        const sanitized = sanitizeCloudReview(r.payload, r.responseMessage);
        return {
          id: r.reviewId,
          persona_id: r.personaId,
          execution_id: r.executionId,
          review_type: 'info',
          content: sanitized.content,
          severity: 'info',
          status: r.status === 'pending' ? 'pending' : r.status,
          reviewer_notes: sanitized.reviewerNotes,
          context_data: null,
          suggested_actions: null,
          title: sanitized.title,
          created_at: safeTimestampToISO(r.createdAt) ?? new Date().toISOString(),
          resolved_at: safeTimestampToISO(r.resolvedAt),
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

      const bundle = await withRetry(
        () => getOverviewBundle(days, personaId),
        "Failed to load observability metrics",
      );
      const summary = canReuseDashboard
        ? {
            totalExecutions: dashboard.total_executions,
            successfulExecutions: dashboard.successful_executions,
            failedExecutions: dashboard.failed_executions,
            totalCostUsd: dashboard.total_cost,
            activePersonas: dashboard.active_personas,
            periodDays: days,
          }
        : bundle.metricsSummary;
      const chartData = bundle.metricsChartData;
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
