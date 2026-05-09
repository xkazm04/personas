import { useEffect, useMemo, useCallback, useState } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import type { PieDataPoint } from '../components/MetricsCharts';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { useAnnotationData } from './useAnnotationData';

export function useObservabilityData() {
  const {
    fetchObservabilityMetrics, observabilityMetrics, observabilityError,
    healingIssues, healingRunning, fetchHealingIssues, triggerHealing,
    resolveHealingIssue, setOverviewTab,
  } = useOverviewStore(useShallow((s) => ({
    fetchObservabilityMetrics: s.fetchObservabilityMetrics,
    observabilityMetrics: s.observabilityMetrics,
    observabilityError: s.observabilityError,
    healingIssues: s.healingIssues,
    healingRunning: s.healingRunning,
    fetchHealingIssues: s.fetchHealingIssues,
    triggerHealing: s.triggerHealing,
    resolveHealingIssue: s.resolveHealingIssue,
    setOverviewTab: s.setOverviewTab,
  })));
  const personas = useAgentStore((s) => s.personas);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  const {
    dayRange: days,
    selectedPersonaId,
    customDateRange,
    effectiveDays,
  } = useOverviewFilterValues();
  const {
    setDayRange: setDays,
    setSelectedPersonaId,
    setFailureDrilldownDate,
    setCustomDateRange,
  } = useOverviewFilterActions();

  const [autoRefresh, setAutoRefresh] = useState(false);
  const {
    healingTimeline, healingTimelineLoading, fetchHealingTimeline,
    fetchAlertRules, fetchAlertHistory,
  } = useOverviewStore(useShallow((s) => ({
    healingTimeline: s.healingTimeline,
    healingTimelineLoading: s.healingTimelineLoading,
    fetchHealingTimeline: s.fetchHealingTimeline,
    fetchAlertRules: s.fetchAlertRules,
    fetchAlertHistory: s.fetchAlertHistory,
  })));

  const refreshAll = useCallback(() => {
    return Promise.all([
      fetchObservabilityMetrics(effectiveDays, selectedPersonaId || undefined),
      fetchHealingIssues(),
      fetchAlertRules(true),
      fetchAlertHistory(true),
    ]);
  }, [effectiveDays, selectedPersonaId, fetchObservabilityMetrics, fetchHealingIssues, fetchAlertRules, fetchAlertHistory]);

  useEffect(() => { void fetchCredentials(); }, [fetchCredentials]);

  const evaluateAlertRules = useOverviewStore((s) => s.evaluateAlertRules);

  // Evaluate alert rules whenever metrics change
  useEffect(() => {
    if (observabilityMetrics) evaluateAlertRules();
  }, [observabilityMetrics, evaluateAlertRules]);

  // No mount-time fetch — initial data (observabilityMetrics, healingIssues,
  // alertRules, alertHistory) is loaded by useExecutionDashboardPipeline at
  // the OverviewContent level so subtab switches reuse cached data.

  usePolling(refreshAll, {
    interval: POLLING_CONFIG.dashboardRefresh.interval,
    enabled: autoRefresh,
    maxBackoff: POLLING_CONFIG.dashboardRefresh.maxBackoff,
  });

  const summary = observabilityMetrics?.summary;
  const backendChartData = observabilityMetrics?.chartData;
  const chartData = useMemo(() => backendChartData?.chart_points ?? [], [backendChartData?.chart_points]);
  const chartAnomalies = useMemo(() => backendChartData?.anomalies ?? [], [backendChartData?.anomalies]);

  const pieData: PieDataPoint[] = useMemo(() =>
    (backendChartData?.persona_breakdown ?? []).map((b) => ({
      name: personas.find((p) => p.id === b.persona_id)?.name || b.persona_id,
      executions: b.executions,
      cost: b.cost,
    })),
  [backendChartData?.persona_breakdown, personas]);

  const successRate = summary && summary.totalExecutions > 0
    ? ((summary.successfulExecutions / summary.totalExecutions) * 100).toFixed(1)
    : '0';

  // Trend percentages are deliberately disabled until a proper period-over-
  // period fetch is wired into this hook. The previous implementation split
  // the SAME chartData window in half (first half = 'previous', second half =
  // 'current') and reported the ratio as 'period-over-period change' — but
  // the data was never fetched at 2× the window, so the percentages were
  // statistical noise. Users reacted to phantom 'cost spiked 40%' deltas
  // that meant nothing more than 'the second half of this week was different
  // from the first half of this week'. Returning nulls makes the Summary
  // cards omit the trend chips (the consumer already handles null) instead
  // of lying about a comparison we didn't actually compute.
  // TODO: fetch with `2 × effectiveDays` and compute against the true prior
  // period, or wire this hook to `useExecutionMetrics`'s comparedChartData.
  const trends = useMemo(
    () => ({ cost: null, executions: null, successRate: null, personas: null }),
    [],
  );

  const chartAnnotations = useAnnotationData({ selectedPersonaId, healingIssues });

  return {
    // Filter state
    days, setDays, selectedPersonaId, setSelectedPersonaId, personas,
    customDateRange, setCustomDateRange,
    // Refresh
    autoRefresh, setAutoRefresh, refreshAll,
    // Metrics
    observabilityError, summary, chartData, pieData, chartAnomalies, successRate, trends, chartAnnotations,
    setFailureDrilldownDate, setOverviewTab,
    // Healing (data only — UI state lives in the dashboard)
    healingIssues, healingRunning, triggerHealing,
    resolveHealingIssue, fetchHealingTimeline,
    healingTimeline, healingTimelineLoading,
  };
}
