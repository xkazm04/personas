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
 */

interface NamedFetch {
  name: string;
  fn: () => Promise<unknown>;
}

/** Run fetches with allSettled and report per-source errors to the store. */
function settleAndReport(fetches: NamedFetch[], tag: string) {
  return Promise.allSettled(fetches.map((f) => f.fn())).then((results) => {
    const store = useOverviewStore.getState();
    for (let i = 0; i < results.length; i++) {
      const name = fetches[i]!.name;
      const result = results[i]!;
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        log.error(`[${tag}] ${name} failed:`, result.reason);
        store.setPipelineError(name, msg);
      } else {
        // Clear any previous error for this source on success
        store.setPipelineError(name, null);
      }
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

  // ── Mount-only: alert data is global and not filter-dependent ──
  useEffect(() => {
    void settleAndReport([
      { name: 'alertRules', fn: fetchAlertRules },
      { name: 'alertHistory', fn: fetchAlertHistory },
    ], 'DashboardPipeline');
  }, [fetchAlertRules, fetchAlertHistory]);

  // ── Filter-dependent refresh (re-runs when days/persona/compare change) ──
  const refresh = useCallback(
    () => settleAndReport([
      { name: 'executionDashboard', fn: () => fetchExecutionDashboard(fetchDays) },
      { name: 'observabilityMetrics', fn: () => fetchObservabilityMetrics(fetchDays, selectedPersonaId || undefined) },
      { name: 'toolUsage', fn: () => fetchToolUsage(effectiveDays, selectedPersonaId || undefined) },
      { name: 'healingIssues', fn: fetchHealingIssues },
      { name: 'globalExecutions', fn: () => fetchGlobalExecutions(true, undefined, selectedPersonaId || undefined) },
    ], 'DashboardPipeline'),
    [fetchExecutionDashboard, fetchObservabilityMetrics, fetchToolUsage, fetchHealingIssues, fetchGlobalExecutions, fetchDays, effectiveDays, selectedPersonaId],
  );

  // Debounce filter-driven refreshes to avoid redundant fetches when
  // the user clicks through day ranges or toggles compare mode rapidly.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void refresh(); }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [refresh]);

  return { refresh };
}
