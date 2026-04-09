import { useCallback, useMemo, useRef, useState } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { computePeriodTrends } from '@/features/overview/utils/computeTrends';

/**
 * Exposes high-level summary metrics and an optional auto-refresh toggle
 * for the Analytics subtab.
 *
 * Initial data fetches (observability, tool usage, healing issues) are
 * centralized in useExecutionDashboardPipeline at the OverviewContent
 * level so that subtab switches reuse cached data. This hook only drives
 * the user-toggled auto-refresh polling cycle.
 */
export function useOverviewMetrics() {
  const {
    fetchObservabilityMetrics, observabilityMetrics, observabilityError,
    fetchHealingIssues, executionDashboard,
  } = useOverviewStore(useShallow((s) => ({
    fetchObservabilityMetrics: s.fetchObservabilityMetrics,
    observabilityMetrics: s.observabilityMetrics,
    observabilityError: s.observabilityError,
    fetchHealingIssues: s.fetchHealingIssues,
    executionDashboard: s.executionDashboard,
  })));
  const fetchToolUsage = useAgentStore((s) => s.fetchToolUsage);

  const {
    selectedPersonaId,
    effectiveDays,
    compareEnabled,
    previousPeriodDays,
  } = useOverviewFilterValues();

  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);

  const fetchDays = compareEnabled ? previousPeriodDays : effectiveDays;

  const refreshAll = useCallback(() => {
    return Promise.all([
      fetchObservabilityMetrics(fetchDays, selectedPersonaId || undefined),
      fetchToolUsage(effectiveDays, selectedPersonaId || undefined),
      fetchHealingIssues(),
    ]);
  }, [fetchDays, effectiveDays, selectedPersonaId, fetchObservabilityMetrics, fetchToolUsage, fetchHealingIssues]);

  const refreshAllSafe = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      await refreshInFlightRef.current;
      return;
    }
    const run = (async () => {
      do {
        refreshQueuedRef.current = false;
        await refreshAll();
      } while (refreshQueuedRef.current);
    })();
    refreshInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (refreshInFlightRef.current === run) {
        refreshInFlightRef.current = null;
      }
    }
  }, [refreshAll]);

  // No mount-time useEffect — initial fetch is handled by
  // useExecutionDashboardPipeline at the OverviewContent level.

  usePolling(refreshAllSafe, {
    interval: POLLING_CONFIG.dashboardRefresh.interval,
    enabled: autoRefresh,
    maxBackoff: POLLING_CONFIG.dashboardRefresh.maxBackoff,
  });

  const summary = observabilityMetrics?.summary;
  const successRate = resolveMetricPercent(
    SUCCESS_RATE_IDENTITIES.analyticsSummary,
    { numerator: summary?.successfulExecutions ?? 0, denominator: summary?.totalExecutions ?? 0 },
  ).toFixed(1);

  const costAnomalies = executionDashboard?.cost_anomalies ?? [];

  // Derive trend indicators from execution dashboard daily points
  const trends = useMemo(() => {
    if (!compareEnabled || !executionDashboard?.daily_points.length) return null;
    const chartRows = executionDashboard.daily_points.map((pt) => ({
      cost: pt.total_cost,
      executions: pt.total_executions,
      successRate: pt.success_rate * 100,
      p50: pt.p50_duration_ms,
    }));
    return computePeriodTrends(chartRows, effectiveDays, compareEnabled);
  }, [compareEnabled, effectiveDays, executionDashboard]);

  return {
    summary,
    successRate,
    costAnomalies,
    trends,
    observabilityError,
    autoRefresh,
    setAutoRefresh,
    refreshAllSafe,
  };
}
