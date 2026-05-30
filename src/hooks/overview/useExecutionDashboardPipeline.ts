import { useEffect, useCallback, useRef } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { log } from '@/lib/log';

/**
 * Single canonical fetch lifecycle for the overview section.
 *
 * Call once inside the OverviewFilterProvider tree (OverviewContent).
 * It fetches **all** shared data that multiple subtabs consume:
 *
 *   - executionDashboard  (DashboardHome, Analytics, ExecutionMetrics)
 *   - globalExecutions    (DashboardHome)
 *   - healingIssues       (DashboardHome, Analytics, Observability)
 *   - observabilityMetrics (Analytics, Observability)
 *   - toolUsage           (Analytics)
 *   - alertRules          (Observability)
 *   - alertHistory        (Observability)
 *
 * Uses Promise.allSettled() so that a failure in one source does not
 * block the others. Per-source errors are tracked in the store so
 * widgets with valid data still render while only the failed source
 * shows an error indicator.
 *
 * ## Memoization across route switches
 *
 * `OverviewPage` unmounts whenever the user navigates to another sidebar
 * section, so this hook re-mounts — and would re-fetch everything — every
 * time they return. To avoid that, the last successful run is cached at
 * module scope keyed by the active filter. A re-mount within
 * `PIPELINE_TTL_MS` with an unchanged filter is a no-op: the data is still
 * live in the Zustand store. Changing days/persona/compare, or letting the
 * data go stale, triggers a real refresh. `refresh(true)` forces a fetch
 * regardless of the cache (manual-retry path).
 */

/** How long a completed fetch stays fresh before a re-mount re-fetches. */
const PIPELINE_TTL_MS = 60_000;

/** Last successful filter-dependent run — survives hook unmount/remount. */
let lastPipelineRun: { filterKey: string; at: number } | null = null;
/** Timestamp of the last successful mount-only alert fetch. */
let alertsLoadedAt = 0;

interface NamedFetch {
  name: string;
  fn: () => Promise<unknown>;
}

/**
 * Run fetches with allSettled and report per-source errors to the store.
 * Resolves to `true` when every fetch succeeded — callers use this to
 * decide whether the run is cacheable (a partial failure must not be
 * memoized, so the next re-mount retries).
 */
function settleAndReport(
  fetches: NamedFetch[],
  tag: string,
  signal?: { cancelled: boolean },
): Promise<boolean> {
  return Promise.allSettled(fetches.map((f) => f.fn())).then((results) => {
    if (signal?.cancelled) return false;
    let allOk = true;
    // Collect every source's outcome, then commit the whole wave's pipeline
    // bookkeeping in ONE store write (applyPipelineResults). Previously this
    // looped setPipelineError + setPipelineFetchedAt per source — 2×N
    // sequential set() calls that each drove a dashboard re-render.
    const pipelineResults: Array<{ source: string; error: string | null }> = [];
    for (let i = 0; i < results.length; i++) {
      const name = fetches[i]!.name;
      const result = results[i]!;
      if (result.status === 'rejected') {
        allOk = false;
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        log.error(`[${tag}] ${name} failed:`, result.reason);
        pipelineResults.push({ source: name, error: msg });
      } else {
        pipelineResults.push({ source: name, error: null });
      }
    }
    useOverviewStore.getState().applyPipelineResults(pipelineResults);
    return allOk;
  });
}

interface IdleApi {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
}

/**
 * Yield between fetch waves. Prefers `requestIdleCallback` so wave 2's
 * fetch + store writes land in a genuinely idle slot rather than racing
 * the paint of wave 1's results; falls back to a macrotask where rIC is
 * unavailable (jsdom, legacy Safari).
 */
function idleYield(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as unknown as IdleApi;
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => resolve(), { timeout: 200 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function useExecutionDashboardPipeline() {
  const { effectiveDays, compareEnabled, previousPeriodDays, selectedPersonaId } = useOverviewFilterValues();
  const {
    fetchExecutionDashboard, fetchGlobalExecutions, fetchHealingIssues,
    fetchObservabilityMetrics, fetchAlertRules, fetchAlertHistory,
  } = useOverviewStore(useShallow((s) => ({
    fetchExecutionDashboard: s.fetchExecutionDashboard,
    fetchGlobalExecutions: s.fetchGlobalExecutions,
    fetchHealingIssues: s.fetchHealingIssues,
    fetchObservabilityMetrics: s.fetchObservabilityMetrics,
    fetchAlertRules: s.fetchAlertRules,
    fetchAlertHistory: s.fetchAlertHistory,
  })));
  const fetchToolUsage = useAgentStore((s) => s.fetchToolUsage);

  const fetchDays = compareEnabled ? previousPeriodDays : effectiveDays;
  const mountedRef = useRef({ cancelled: false });

  // Identifies the data shape of a run. A re-mount with the same key can
  // reuse the store's existing data instead of re-fetching.
  const filterKey = `${effectiveDays}|${fetchDays}|${selectedPersonaId || ''}|${compareEnabled ? 1 : 0}`;

  // ── Mount-only: alert data is global and not filter-dependent ──
  // Skipped when a previous mount fetched it within the TTL window.
  useEffect(() => {
    if (Date.now() - alertsLoadedAt < PIPELINE_TTL_MS) return;
    const signal = mountedRef.current;
    void settleAndReport([
      { name: 'alertRules', fn: fetchAlertRules },
      { name: 'alertHistory', fn: fetchAlertHistory },
    ], 'DashboardPipeline', signal).then((ok) => {
      if (ok && !signal.cancelled) alertsLoadedAt = Date.now();
    });
  }, [fetchAlertRules, fetchAlertHistory]);

  // ── Filter-dependent refresh (re-runs when days/persona/compare change) ──
  // Split into two waves with an idle yield between them to avoid 5 concurrent
  // set() calls landing in the same React render frame.
  const refresh = useCallback(
    async (force = false) => {
      const signal = mountedRef.current;
      // Memoization gate: an unchanged filter that ran recently is still
      // live in the store — skip the whole fetch on re-mount.
      if (!force && lastPipelineRun
        && lastPipelineRun.filterKey === filterKey
        && Date.now() - lastPipelineRun.at < PIPELINE_TTL_MS) {
        return;
      }
      // Wave 1: critical above-the-fold data
      const wave1Ok = await settleAndReport([
        { name: 'executionDashboard', fn: () => fetchExecutionDashboard(fetchDays) },
        { name: 'globalExecutions', fn: () => fetchGlobalExecutions(true, undefined, selectedPersonaId || undefined) },
      ], 'DashboardPipeline', signal);
      if (signal.cancelled) return;
      // Cache only a clean run — a partial failure should retry next mount.
      if (wave1Ok) lastPipelineRun = { filterKey, at: Date.now() };
      // Yield to an idle slot so wave 2 doesn't race wave 1's paint.
      await idleYield();
      if (signal.cancelled) return;
      // Wave 2: secondary data
      await settleAndReport([
        { name: 'observabilityMetrics', fn: () => fetchObservabilityMetrics(fetchDays, selectedPersonaId || undefined) },
        { name: 'toolUsage', fn: () => fetchToolUsage(effectiveDays, selectedPersonaId || undefined) },
        { name: 'healingIssues', fn: fetchHealingIssues },
      ], 'DashboardPipeline', signal);
    },
    [fetchExecutionDashboard, fetchObservabilityMetrics, fetchToolUsage, fetchHealingIssues, fetchGlobalExecutions, fetchDays, effectiveDays, selectedPersonaId, filterKey],
  );

  // Debounce filter-driven refreshes to avoid redundant fetches when
  // the user clicks through day ranges or toggles compare mode rapidly.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void refresh(); }, 250);
    const debounce = debounceRef;
    const mounted = mountedRef;
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      mounted.current.cancelled = true;
    };
  }, [refresh]);

  return { refresh };
}
