import { useEffect, useCallback } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';

/**
 * Single canonical fetch lifecycle for the execution dashboard.
 *
 * Call once inside the OverviewFilterProvider tree. It auto-fetches
 * when the filter context changes (day range, compare toggle, custom dates)
 * so that all downstream consumers (DashboardHome, AnalyticsDashboard,
 * ExecutionMetricsDashboard) read a consistent `executionDashboard` from
 * the store without triggering their own independent fetches.
 */
export function useExecutionDashboardPipeline() {
  const { effectiveDays, compareEnabled, previousPeriodDays } = useOverviewFilters();
  const fetchExecutionDashboard = useOverviewStore((s) => s.fetchExecutionDashboard);

  const fetchDays = compareEnabled ? previousPeriodDays : effectiveDays;

  const refresh = useCallback(
    () => fetchExecutionDashboard(fetchDays),
    [fetchExecutionDashboard, fetchDays],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  return { refresh };
}
