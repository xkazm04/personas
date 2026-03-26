import { useEffect, useCallback } from 'react';
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
 * By running at the OverviewPage level, subtab switches reuse the
 * already-cached store data instead of re-fetching on every mount.
 */
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

  // ── Filter-dependent refresh (re-runs when days/persona/compare change) ──
  const refresh = useCallback(
    () => Promise.all([
      fetchExecutionDashboard(fetchDays),
      fetchObservabilityMetrics(fetchDays, selectedPersonaId || undefined),
      fetchToolUsage(effectiveDays, selectedPersonaId || undefined),
      fetchHealingIssues(),
      fetchGlobalExecutions(true, undefined, selectedPersonaId || undefined),
      fetchAlertRules(),
      fetchAlertHistory(),
    ]).catch((err) => {
      log.error('[DashboardPipeline] Fetch failed:', err);
      useOverviewStore.getState().setPipelineError(
        err instanceof Error ? err.message : 'Dashboard data fetch failed'
      );
    }),
    [fetchExecutionDashboard, fetchObservabilityMetrics, fetchToolUsage, fetchHealingIssues, fetchGlobalExecutions, fetchAlertRules, fetchAlertHistory, fetchDays, effectiveDays, selectedPersonaId],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  return { refresh };
}
