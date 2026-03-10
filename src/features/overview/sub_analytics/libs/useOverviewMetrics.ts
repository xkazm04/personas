import { useEffect, useCallback, useRef, useState } from 'react';
import { usePersonaStore, initHealingListener } from '@/stores/personaStore';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilters } from '@/features/overview/components/OverviewFilterContext';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/usePolling';

/**
 * Owns the analytics data-fetch lifecycle (observability metrics, tool usage,
 * healing issues) and exposes high-level summary metrics.
 */
export function useOverviewMetrics() {
  const fetchObservabilityMetrics = usePersonaStore((s) => s.fetchObservabilityMetrics);
  const observabilityMetrics = usePersonaStore((s) => s.observabilityMetrics);
  const observabilityError = usePersonaStore((s) => s.observabilityError);
  const fetchHealingIssues = usePersonaStore((s) => s.fetchHealingIssues);
  const fetchToolUsage = usePersonaStore((s) => s.fetchToolUsage);
  const executionDashboard = usePersonaStore((s) => s.executionDashboard);

  const {
    selectedPersonaId,
    effectiveDays,
    compareEnabled,
    previousPeriodDays,
  } = useOverviewFilters();

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

  useEffect(() => { initHealingListener(); }, []);
  useEffect(() => { void refreshAllSafe(); }, [refreshAllSafe]);

  usePolling(refreshAllSafe, {
    interval: POLLING_CONFIG.dashboardRefresh.interval,
    enabled: autoRefresh,
    maxBackoff: POLLING_CONFIG.dashboardRefresh.maxBackoff,
  });

  const summary = observabilityMetrics?.summary;
  const successRate = resolveMetricPercent(
    SUCCESS_RATE_IDENTITIES.analyticsSummary,
    { numerator: summary?.successful_executions ?? 0, denominator: summary?.total_executions ?? 0 },
  ).toFixed(1);

  const costAnomalies = executionDashboard?.cost_anomalies ?? [];

  return {
    summary,
    successRate,
    costAnomalies,
    observabilityError,
    autoRefresh,
    setAutoRefresh,
    refreshAllSafe,
  };
}
