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
import type { PersonaMonthlySpend } from "@/lib/bindings/PersonaMonthlySpend";
import type { ExecutionDashboardData } from "@/lib/bindings/ExecutionDashboardData";
import type { MetricsChartPoint } from "@/lib/bindings/MetricsChartPoint";
import * as api from "@/api/tauriApi";

// ── Budget alert types ────────────────────────────────────────────────
export interface BudgetWarning {
  personaId: string;
  name: string;
  spend: number;
  budget: number;
  ratio: number;
  exceeded: boolean;
}

export interface OverviewSlice {
  // State — navigation
  overviewTab: OverviewTab;

  // State — executions
  globalExecutions: GlobalExecution[];
  globalExecutionsTotal: number;
  globalExecutionsOffset: number;
  globalExecutionsWarning: string | null;

  // State — reviews
  manualReviews: ManualReviewItem[];
  manualReviewsTotal: number;
  pendingReviewCount: number;

  // State — observability metrics
  observabilityMetrics: ObservabilityMetrics | null;
  observabilityError: string | null;

  // State — execution dashboard (canonical metrics source)
  executionDashboard: ExecutionDashboardData | null;
  executionDashboardLoading: boolean;
  executionDashboardError: string | null;

  // State — monthly spend (centralized)
  monthlySpend: PersonaMonthlySpend[];
  monthlySpendLoading: boolean;
  monthlySpendError: string | null;

  // Actions
  setOverviewTab: (tab: OverviewTab) => void;
  fetchGlobalExecutions: (reset?: boolean, status?: string) => Promise<void>;
  fetchManualReviews: (status?: string) => Promise<void>;
  updateManualReview: (id: string, updates: { status?: string; reviewer_notes?: string }) => Promise<void>;
  fetchPendingReviewCount: () => Promise<void>;
  fetchObservabilityMetrics: (days?: number, personaId?: string) => Promise<void>;
  fetchExecutionDashboard: (days?: number) => Promise<void>;
  fetchMonthlySpend: () => Promise<void>;
}

// ── Budget selectors (pure functions over slice state) ─────────────────
export function selectMonthlySpendMap(spend: PersonaMonthlySpend[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const d of spend) map[d.id] = d.spend ?? 0;
  return map;
}

export function selectTotalMonthlySpend(spend: PersonaMonthlySpend[]): number {
  return spend.reduce((sum, d) => sum + (d.spend ?? 0), 0);
}

export function selectBudgetWarnings(spend: PersonaMonthlySpend[]): BudgetWarning[] {
  return spend
    .filter((d) => d.max_budget_usd != null && d.max_budget_usd > 0 && d.spend >= d.max_budget_usd * 0.8)
    .map((d) => {
      const ratio = d.spend / d.max_budget_usd!;
      return {
        personaId: d.id,
        name: d.name,
        spend: d.spend,
        budget: d.max_budget_usd!,
        ratio,
        exceeded: ratio >= 1,
      };
    });
}

export function selectBudgetData(spend: PersonaMonthlySpend[]): Array<{ personaId: string; name: string; spend: number; budget: number | null }> {
  return spend.map((d) => ({ personaId: d.id, name: d.name, spend: d.spend, budget: d.max_budget_usd }));
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

// Grow-the-window pagination: each "Load More" widens the per-persona fetch limit.
let currentPerPersonaLimit = 25;
const PER_PERSONA_PAGE_SIZE = 25;
const MAX_PER_PERSONA_LIMIT = 250;

export const createOverviewSlice: StateCreator<PersonaStore, [], [], OverviewSlice> = (set, get) => ({
  overviewTab: "home" as OverviewTab,
  globalExecutions: [],
  globalExecutionsTotal: 0,
  globalExecutionsOffset: 0,
  globalExecutionsWarning: null,
  manualReviews: [],
  manualReviewsTotal: 0,
  pendingReviewCount: 0,
  observabilityMetrics: null,
  observabilityError: null,
  executionDashboard: null,
  executionDashboardLoading: false,
  executionDashboardError: null,
  monthlySpend: [],
  monthlySpendLoading: false,
  monthlySpendError: null,

  setOverviewTab: (tab) => set({ overviewTab: tab }),

  fetchGlobalExecutions: async (reset = false) => {
    try {
      if (reset) {
        currentPerPersonaLimit = PER_PERSONA_PAGE_SIZE;
      } else {
        currentPerPersonaLimit = Math.min(
          currentPerPersonaLimit + PER_PERSONA_PAGE_SIZE,
          MAX_PER_PERSONA_LIMIT,
        );
      }

      const { personas } = get();
      let anyAtLimit = false;
      const failedPersonaNames: string[] = [];
      const allExecs = await Promise.all(
        personas.map(async (p) => {
          try {
            const execs = await api.listExecutions(p.id, currentPerPersonaLimit);
            if (execs.length >= currentPerPersonaLimit) anyAtLimit = true;
            return enrichWithPersona(execs, [p]);
          } catch {
            // intentional: error state handled by store — per-persona failures collected in globalExecutionsWarning
            failedPersonaNames.push(p.name);
            return [];
          }
        }),
      );
      const merged = allExecs
        .flat()
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

      set({
        globalExecutions: merged,
        // Signal hasMore: offset < total only when some persona may have more rows
        globalExecutionsTotal: merged.length + (anyAtLimit ? 1 : 0),
        globalExecutionsOffset: merged.length,
        globalExecutionsWarning: failedPersonaNames.length > 0
          ? `Execution data is incomplete. Failed to load ${failedPersonaNames.length} persona${failedPersonaNames.length === 1 ? '' : 's'}: ${failedPersonaNames.join(', ')}`
          : null,
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

  fetchMonthlySpend: async () => {
    set({ monthlySpendLoading: true });
    try {
      const data = await api.getAllMonthlySpend();
      set({ monthlySpend: data, monthlySpendError: null, monthlySpendLoading: false });
    } catch (err) {
      set({ monthlySpend: [], monthlySpendError: errMsg(err, "Failed to load monthly spend"), monthlySpendLoading: false });
    }
  },

});
