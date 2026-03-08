import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { usePersonaStore, initHealingListener } from '@/stores/personaStore';
import { mergePreviousPeriod } from '@/features/overview/sub_usage/libs/periodComparison';
import { pivotToolUsageOverTime } from '@/features/overview/sub_usage/libs/pivotToolUsage';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilters } from '@/features/overview/components/OverviewFilterContext';
import { formatToolName } from './analyticsHelpers';
import type { PieDataPoint } from '@/features/overview/sub_observability/components/MetricsCharts';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

export function useAnalyticsData() {
  // ── Observability store ──
  const fetchObservabilityMetrics = usePersonaStore((s) => s.fetchObservabilityMetrics);
  const observabilityMetrics = usePersonaStore((s) => s.observabilityMetrics);
  const observabilityError = usePersonaStore((s) => s.observabilityError);
  const healingIssues = usePersonaStore((s) => s.healingIssues);
  const healingRunning = usePersonaStore((s) => s.healingRunning);
  const fetchHealingIssues = usePersonaStore((s) => s.fetchHealingIssues);
  const triggerHealing = usePersonaStore((s) => s.triggerHealing);
  const resolveHealingIssue = usePersonaStore((s) => s.resolveHealingIssue);

  // ── Execution dashboard store ──
  const executionDashboard = usePersonaStore((s) => s.executionDashboard);
  const fetchExecutionDashboard = usePersonaStore((s) => s.fetchExecutionDashboard);

  // ── Tool usage store ──
  const toolUsageSummary = usePersonaStore((s) => s.toolUsageSummary);
  const toolUsageOverTime = usePersonaStore((s) => s.toolUsageOverTime);
  const fetchToolUsage = usePersonaStore((s) => s.fetchToolUsage);

  const personas = usePersonaStore((s) => s.personas);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);

  // ── Shared filter state ──
  const {
    dayRange: days,
    setDayRange: setDays,
    selectedPersonaId,
    setSelectedPersonaId,
    setFailureDrilldownDate,
    customDateRange,
    setCustomDateRange,
    effectiveDays,
    compareEnabled,
    setCompareEnabled,
    previousPeriodDays,
  } = useOverviewFilters();
  const [autoRefresh, setAutoRefresh] = useState(false);

  // ── Healing state ──
  const [selectedIssue, setSelectedIssue] = useState<PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{
    failures_analyzed: number;
    issues_created: number;
    auto_fixed: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);

  // ── Data fetching ──
  const fetchDays = compareEnabled ? previousPeriodDays : effectiveDays;
  const refreshAll = useCallback(() => {
    return Promise.all([
      fetchObservabilityMetrics(fetchDays, selectedPersonaId || undefined),
      fetchExecutionDashboard(fetchDays),
      fetchToolUsage(effectiveDays, selectedPersonaId || undefined),
      fetchHealingIssues(),
    ]);
  }, [fetchDays, effectiveDays, selectedPersonaId, fetchObservabilityMetrics, fetchExecutionDashboard, fetchToolUsage, fetchHealingIssues]);

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
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => { void refreshAllSafe(); }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshAllSafe]);

  // ── Observability metrics ──
  const summary = observabilityMetrics?.summary;
  const backendChartData = observabilityMetrics?.chartData;
  const rawChartData = backendChartData?.chart_points ?? [];

  const chartData = useMemo(() => {
    if (!compareEnabled || rawChartData.length === 0) return rawChartData;
    return mergePreviousPeriod(rawChartData, effectiveDays, ['cost', 'executions', 'success', 'failed']);
  }, [compareEnabled, rawChartData, effectiveDays]);

  const pieData: PieDataPoint[] = useMemo(() =>
    (backendChartData?.persona_breakdown ?? []).map((b) => ({
      name: personas.find((p) => p.id === b.persona_id)?.name || b.persona_id,
      executions: b.executions,
      cost: b.cost,
    })),
  [backendChartData?.persona_breakdown, personas]);

  const successRate = resolveMetricPercent(
    SUCCESS_RATE_IDENTITIES.analyticsSummary,
    { numerator: summary?.successful_executions ?? 0, denominator: summary?.total_executions ?? 0 },
  ).toFixed(1);

  // ── Tool usage chart data ──
  const { areaData, allToolNames } = useMemo(() => {
    return pivotToolUsageOverTime(toolUsageOverTime);
  }, [toolUsageOverTime]);

  const barData = useMemo(
    () => [...toolUsageSummary]
      .sort((a, b) => b.total_invocations - a.total_invocations)
      .map((s) => ({
        name: formatToolName(s.tool_name),
        invocations: s.total_invocations,
        executions: s.unique_executions,
        personas: s.unique_personas,
      })),
    [toolUsageSummary],
  );

  // ── Execution dashboard derived data ──
  const latencyData = useMemo(() => {
    if (!executionDashboard) return [];
    return executionDashboard.daily_points.map((pt) => ({
      date: pt.date,
      p50: pt.p50_duration_ms,
      p95: pt.p95_duration_ms,
      p99: pt.p99_duration_ms,
    }));
  }, [executionDashboard]);

  const costAnomalies = executionDashboard?.cost_anomalies ?? [];

  // ── Issue management ──
  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null);
    setAnalysisError(null);
    const targetPersonaId = selectedPersonaId || personas[0]?.id;
    if (!targetPersonaId) {
      setAnalysisError('No persona available for analysis. Create a persona first.');
      return;
    }
    try {
      const result = await triggerHealing(targetPersonaId);
      if (result) setAnalysisResult(result);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Failed to run analysis. Please retry.');
    }
  }, [triggerHealing, selectedPersonaId, personas]);

  const handleFailureBarClick = useCallback((data: { date?: string; failed?: number }) => {
    if (!data.date || data.failed === 0) return;
    setFailureDrilldownDate(data.date);
    setOverviewTab('knowledge');
  }, [setFailureDrilldownDate, setOverviewTab]);

  const { issueCounts, sortedFilteredIssues } = useMemo(() => {
    let open = 0, autoFixed = 0;
    for (const i of healingIssues) {
      if (i.auto_fixed) autoFixed++;
      else open++;
    }
    const counts = { all: healingIssues.length, open, autoFixed };
    const filtered = issueFilter === 'all' ? healingIssues
      : issueFilter === 'open' ? healingIssues.filter(i => !i.auto_fixed)
      : healingIssues.filter(i => i.auto_fixed);
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...filtered].sort((a, b) => {
      if (a.auto_fixed !== b.auto_fixed) return a.auto_fixed ? 1 : -1;
      return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    });
    return { issueCounts: counts, sortedFilteredIssues: sorted };
  }, [healingIssues, issueFilter]);

  return {
    // filter state
    days, setDays, selectedPersonaId, setSelectedPersonaId,
    customDateRange, setCustomDateRange,
    compareEnabled, setCompareEnabled,
    autoRefresh, setAutoRefresh,
    personas,
    // data
    summary, chartData, pieData, successRate,
    areaData, allToolNames, barData, latencyData,
    costAnomalies, observabilityError,
    // healing
    healingIssues, healingRunning, resolveHealingIssue,
    selectedIssue, setSelectedIssue,
    issueFilter, setIssueFilter,
    analysisResult, setAnalysisResult,
    analysisError, setAnalysisError,
    handleRunAnalysis, handleFailureBarClick,
    issueCounts, sortedFilteredIssues,
    // actions
    refreshAllSafe,
  };
}
