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
      fetchHealingIssues(selectedPersonaId ?? null),
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

  const chartAnnotations = useAnnotationData({ selectedPersonaId, healingIssues });

  return {
    // Filter state
    days, setDays, selectedPersonaId, setSelectedPersonaId, personas,
    customDateRange, setCustomDateRange,
    // Refresh
    autoRefresh, setAutoRefresh, refreshAll,
    // Metrics
    observabilityError, summary, chartData, pieData, chartAnomalies, chartAnnotations,
    setFailureDrilldownDate, setOverviewTab,
    // Healing (data only — UI state lives in the dashboard)
    healingIssues, healingRunning, triggerHealing,
    resolveHealingIssue, fetchHealingTimeline,
    healingTimeline, healingTimelineLoading,
  };
}
