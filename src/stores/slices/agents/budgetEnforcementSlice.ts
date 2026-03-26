import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import type { PersonaMonthlySpend } from "@/lib/bindings/PersonaMonthlySpend";
import { getAllMonthlySpend } from "@/api/overview/observability";
import { deduplicateFetch } from "@/lib/utils/deduplicateFetch";
import { createLogger } from "@/lib/log";

const logger = createLogger("budget");

// -- Budget enforcement lifecycle ---------------------------------------
//
// Budget enforcement connects the spend-tracking system to the execution
// pipeline so exceeding a budget has real consequences:
//
//   spend / max_budget_usd >= 1.0  ->  persona is "budget-paused"
//     - Scheduled triggers are suppressed (no new executions)
//     - Ad-hoc runs require explicit override (user clicks "Run anyway")
//     - A warning badge appears in the UI
//
//   spend / max_budget_usd >= 0.8  ->  "budget-warning"
//     - Warning indicators appear but execution continues
//
// The enforcement is *frontend-only* gating -- the Rust backend doesn't
// know about budget pause. This is intentional: the user always retains
// override capability, and the backend budget (max_budget_usd per
// execution) still hard-caps individual runs.

/** How long cached budget data is considered fresh (ms). */
export const BUDGET_TTL_MS = 60_000; // 1 minute

export type BudgetStatus = 'ok' | 'warning' | 'exceeded' | 'stale';

export interface PersonaBudgetState {
  personaId: string;
  name: string;
  spend: number;
  maxBudget: number | null;
  ratio: number;
  status: BudgetStatus;
}

export interface BudgetEnforcementSlice {
  // State
  budgetSpendMap: Map<string, PersonaBudgetState>;
  budgetEnforcementLoading: boolean;
  budgetStale: boolean;
  /** Epoch-ms when budget data was last successfully fetched. */
  budgetLastFetchedAt: number | null;
  /** Set of persona IDs where user explicitly overrode budget pause for current session */
  budgetOverrides: Set<string>;
  /** Set of persona IDs where user explicitly overrode stale-budget blocking (session-scoped) */
  budgetStaleOverrides: Set<string>;

  // Actions
  fetchBudgetSpend: () => Promise<void>;
  /** Check if a persona is budget-gated. Returns the status. */
  getBudgetStatus: (personaId: string) => BudgetStatus;
  /** Returns true if execution should be blocked (exceeded/stale + no override) */
  isBudgetBlocked: (personaId: string) => boolean;
  /** User explicitly overrides budget pause for this persona (session-scoped) */
  overrideBudgetPause: (personaId: string) => void;
  /** User explicitly overrides stale-budget blocking for this persona (session-scoped) */
  overrideStaleBudget: (personaId: string) => void;
  /** Clear all overrides (e.g. on budget refresh) */
  clearBudgetOverrides: () => void;
  /** Invalidate cached budget data, triggering a re-fetch. Data is marked stale (fail-closed) until refresh completes. */
  invalidateBudgetCache: (personaId?: string) => void;
}

function deriveStatus(spend: number, maxBudget: number | null): { ratio: number; status: BudgetStatus } {
  if (!maxBudget || maxBudget <= 0) return { ratio: 0, status: 'ok' };
  const ratio = spend / maxBudget;
  if (ratio >= 1.0) return { ratio, status: 'exceeded' };
  if (ratio >= 0.8) return { ratio, status: 'warning' };
  return { ratio, status: 'ok' };
}

function buildMap(rows: PersonaMonthlySpend[]): Map<string, PersonaBudgetState> {
  const map = new Map<string, PersonaBudgetState>();
  for (const row of rows) {
    const { ratio, status } = deriveStatus(row.spend, row.max_budget_usd);
    map.set(row.id, {
      personaId: row.id,
      name: row.name,
      spend: row.spend,
      maxBudget: row.max_budget_usd,
      ratio,
      status,
    });
  }
  return map;
}

export const createBudgetEnforcementSlice: StateCreator<AgentStore, [], [], BudgetEnforcementSlice> = (set, get) => ({
  budgetSpendMap: new Map(),
  budgetEnforcementLoading: false,
  budgetStale: false,
  budgetLastFetchedAt: null,
  budgetOverrides: new Set(),
  budgetStaleOverrides: new Set(),

  fetchBudgetSpend: deduplicateFetch('budgetSpend', async () => {
    set({ budgetEnforcementLoading: true });
    try {
      const rows = await getAllMonthlySpend();
      set({ budgetSpendMap: buildMap(rows), budgetEnforcementLoading: false, budgetStale: false, budgetLastFetchedAt: Date.now() });
    } catch (err) {
      logger.warn("fetchBudgetSpend failed — budget enforcement active (fail-closed)", { error: String(err) });
      set({ budgetEnforcementLoading: false, budgetStale: true });
    }
  }),

  getBudgetStatus: (personaId: string) => {
    const state = get();
    if (state.budgetStale) {
      // Passive refresh: kick off a background fetch so the next check has fresh data
      void get().fetchBudgetSpend();
      return 'stale';
    }
    // Treat cache as stale if it's older than the TTL
    if (state.budgetLastFetchedAt !== null && Date.now() - state.budgetLastFetchedAt > BUDGET_TTL_MS) {
      // Passive refresh on TTL expiry
      void get().fetchBudgetSpend();
      return 'stale';
    }
    const entry = state.budgetSpendMap.get(personaId);
    // Fail-closed: if budget data has been fetched before but this persona
    // has no entry, treat as stale rather than ok to prevent a fail-open window
    // (e.g. during cache invalidation re-fetch).
    if (!entry && state.budgetLastFetchedAt !== null) return 'stale';
    return entry?.status ?? 'ok';
  },

  isBudgetBlocked: (personaId: string) => {
    const state = get();
    // Fail closed: if budget data is stale, block unless user explicitly overrode
    if (state.budgetStale) {
      // Passive refresh so stale state resolves automatically
      void get().fetchBudgetSpend();
      return !state.budgetStaleOverrides.has(personaId);
    }
    if (state.budgetLastFetchedAt !== null && Date.now() - state.budgetLastFetchedAt > BUDGET_TTL_MS) {
      // Passive refresh on TTL expiry
      void get().fetchBudgetSpend();
      return !state.budgetStaleOverrides.has(personaId);
    }
    const entry = state.budgetSpendMap.get(personaId);
    // Fail-closed: missing entry after initial fetch means data is in-flight
    // (e.g. during invalidation re-fetch) — block unless user overrode stale
    if (!entry) {
      if (state.budgetLastFetchedAt !== null) return !state.budgetStaleOverrides.has(personaId);
      return false;
    }
    if (entry.status !== 'exceeded') return false;
    return !state.budgetOverrides.has(personaId);
  },

  overrideBudgetPause: (personaId: string) => {
    set((state) => {
      const next = new Set(state.budgetOverrides);
      next.add(personaId);
      return { budgetOverrides: next };
    });
  },

  overrideStaleBudget: (personaId: string) => {
    set((state) => {
      const next = new Set(state.budgetStaleOverrides);
      next.add(personaId);
      return { budgetStaleOverrides: next };
    });
  },

  clearBudgetOverrides: () => {
    set({ budgetOverrides: new Set(), budgetStaleOverrides: new Set() });
  },

  invalidateBudgetCache: (_personaId?: string) => {
    // Mark data as stale but preserve existing entries so enforcement
    // remains fail-closed until the re-fetch completes.
    set({ budgetStale: true });
    // Fire-and-forget re-fetch so fresh data arrives quickly
    void get().fetchBudgetSpend();
  },
});
