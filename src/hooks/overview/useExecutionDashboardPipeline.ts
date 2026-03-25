import { useEffect, useCallback } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';

/**
 * Single canonical fetch lifecycle for the overview section.
 *
 * Call once inside the OverviewFilterProvider tree (OverviewContent).
 * It fetches **all** shared data that multiple subtabs consume:
 *
 *   - executionDashboard  (DashboardHome, Analytics, ExecutionMetrics)
 *   - globalExecutions    (DashboardHome)
 *   - healingIssues       (DashboardHome, Analytics)
 *   - observabilityMetrics (Analytics)
 *   - toolUsage           (Analytics)
 *
 * By running at the OverviewPage level, subtab switches reuse the
 * already-cached store data instead of re-fetching on every mount.
 */
export function useExecutionDashboardPipeline() {
  const { effectiveDays, compareEnabled, previousPeriodDays, selectedPersonaId } = useOverviewFilterValues();
  const fetchExecutionDashboard = useOverviewStore((s) => s.fetchExecutionDashboard);
  const fetchGlobalExecutions = useOverviewStore((s) => s.fetchGlobalExecutions);
  const fetchHealingIssues = useOverviewStore((s) => s.fetchHealingIssues);
  const fetchObservabilityMetrics = useOverviewStore((s) => s.fetchObservabilityMetrics);
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
    ]),
    [fetchExecutionDashboard, fetchObservabilityMetrics, fetchToolUsage, fetchHealingIssues, fetchGlobalExecutions, fetchDays, effectiveDays, selectedPersonaId],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  return { refresh };
}
