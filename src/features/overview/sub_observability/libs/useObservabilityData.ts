import { useEffect, useMemo, useCallback, useState } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import type { PieDataPoint } from '../components/MetricsCharts';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { useAnnotationData } from './useAnnotationData';

export function useObservabilityData() {
  const fetchObservabilityMetrics = useOverviewStore((s) => s.fetchObservabilityMetrics);
  const observabilityMetrics = useOverviewStore((s) => s.observabilityMetrics);
  const observabilityError = useOverviewStore((s) => s.observabilityError);
  const personas = useAgentStore((s) => s.personas);
  const healingIssues = useOverviewStore((s) => s.healingIssues);
  const healingRunning = useOverviewStore((s) => s.healingRunning);
  const fetchHealingIssues = useOverviewStore((s) => s.fetchHealingIssues);
  const triggerHealing = useOverviewStore((s) => s.triggerHealing);
  const resolveHealingIssue = useOverviewStore((s) => s.resolveHealingIssue);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  const {
    dayRange: days,
    setDayRange: setDays,
    selectedPersonaId,
    setSelectedPersonaId,
    setFailureDrilldownDate,
    customDateRange,
    setCustomDateRange,
    effectiveDays,
  } = useOverviewFilters();

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<import('@/lib/bindings/PersonaHealingIssue').PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{
    failures_analyzed: number;
    issues_created: number;
    auto_fixed: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [healingViewMode, setHealingViewMode] = useState<'list' | 'timeline'>('list');
  const healingTimeline = useOverviewStore((s) => s.healingTimeline);
  const healingTimelineLoading = useOverviewStore((s) => s.healingTimelineLoading);
  const fetchHealingTimeline = useOverviewStore((s) => s.fetchHealingTimeline);

  const refreshAll = useCallback(() => {
    return Promise.all([
      fetchObservabilityMetrics(effectiveDays, selectedPersonaId || undefined),
      fetchHealingIssues(),
    ]);
  }, [effectiveDays, selectedPersonaId, fetchObservabilityMetrics, fetchHealingIssues]);

  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null);
    setAnalysisError(null);
    try {
      const result = await triggerHealing(selectedPersonaId || personas[0]?.id);
      if (result) {
        setAnalysisResult(result);
      } else {
        setAnalysisError('Healing analysis failed. Please try again.');
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Healing analysis failed');
    }
  }, [triggerHealing, selectedPersonaId, personas]);

  useEffect(() => { void fetchCredentials(); }, [fetchCredentials]);

  const evaluateAlertRules = useOverviewStore((s) => s.evaluateAlertRules);

  // Evaluate alert rules whenever metrics change
  useEffect(() => {
    if (observabilityMetrics) evaluateAlertRules();
  }, [observabilityMetrics, evaluateAlertRules]);

  // Fetch timeline when switching to timeline view or when persona changes
  useEffect(() => {
    if (healingViewMode === 'timeline') {
      const pid = selectedPersonaId || personas[0]?.id;
      if (pid) fetchHealingTimeline(pid);
    }
  }, [healingViewMode, selectedPersonaId, personas, fetchHealingTimeline]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  usePolling(refreshAll, {
    interval: POLLING_CONFIG.dashboardRefresh.interval,
    enabled: autoRefresh,
    maxBackoff: POLLING_CONFIG.dashboardRefresh.maxBackoff,
  });

  const summary = observabilityMetrics?.summary;
  const backendChartData = observabilityMetrics?.chartData;
  const chartData = backendChartData?.chart_points ?? [];

  const pieData: PieDataPoint[] = useMemo(() =>
    (backendChartData?.persona_breakdown ?? []).map((b) => ({
      name: personas.find((p) => p.id === b.persona_id)?.name || b.persona_id,
      executions: b.executions,
      cost: b.cost,
    })),
  [backendChartData?.persona_breakdown, personas]);

  const successRate = summary && summary.total_executions > 0
    ? ((summary.successful_executions / summary.total_executions) * 100).toFixed(1)
    : '0';

  const trends = useMemo(() => {
    if (chartData.length < 2) return { cost: null, executions: null, successRate: null, personas: null };
    const mid = Math.floor(chartData.length / 2);
    const prev = chartData.slice(0, mid);
    const curr = chartData.slice(mid);
    const sum = (arr: typeof chartData, key: 'cost' | 'executions' | 'success' | 'failed') =>
      arr.reduce((acc, d) => acc + d[key], 0);
    const prevCost = sum(prev, 'cost');
    const currCost = sum(curr, 'cost');
    const prevExec = sum(prev, 'executions');
    const currExec = sum(curr, 'executions');
    const prevSuccess = sum(prev, 'success');
    const prevTotal = prevSuccess + sum(prev, 'failed');
    const currSuccess = sum(curr, 'success');
    const currTotal = currSuccess + sum(curr, 'failed');
    const prevRate = prevTotal > 0 ? (prevSuccess / prevTotal) * 100 : 0;
    const currRate = currTotal > 0 ? (currSuccess / currTotal) * 100 : 0;
    const pctChange = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100;
    const prevPersonas = prev.reduce((acc, d) => acc + d.active_personas, 0) / (prev.length || 1);
    const currPersonas = curr.reduce((acc, d) => acc + d.active_personas, 0) / (curr.length || 1);
    return {
      cost: { pct: pctChange(currCost, prevCost), invertColor: true },
      executions: { pct: pctChange(currExec, prevExec), invertColor: false },
      successRate: { pct: currRate - prevRate, invertColor: false },
      personas: { pct: pctChange(currPersonas, prevPersonas), invertColor: false },
    };
  }, [chartData]);

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

  const chartAnnotations = useAnnotationData({ selectedPersonaId, healingIssues });

  return {
    // Filter state
    days, setDays, selectedPersonaId, setSelectedPersonaId, personas,
    customDateRange, setCustomDateRange,
    // Refresh
    autoRefresh, setAutoRefresh, refreshAll,
    // Metrics
    observabilityError, summary, chartData, pieData, successRate, trends, chartAnnotations,
    setFailureDrilldownDate, setOverviewTab,
    // Healing
    healingIssues, healingRunning, handleRunAnalysis,
    resolveHealingIssue, selectedIssue, setSelectedIssue,
    issueFilter, setIssueFilter, issueCounts, sortedFilteredIssues,
    analysisResult, setAnalysisResult, analysisError, setAnalysisError,
    // Timeline
    healingViewMode, setHealingViewMode, healingTimeline, healingTimelineLoading,
  };
}
