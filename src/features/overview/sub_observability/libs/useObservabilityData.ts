import { useEffect, useMemo, useCallback, useState } from 'react';
import { usePersonaStore, initHealingListener } from '@/stores/personaStore';
import { getPromptVersions } from '@/api/observability';
import { getRotationHistory } from '@/api/rotation';
import { useOverviewFilters } from '@/features/overview/components/OverviewFilterContext';
import type { ChartAnnotationRecord } from './chartAnnotations';
import { toChartDate, useAnnotationComposer } from './chartAnnotations';
import type { PieDataPoint } from '../components/MetricsCharts';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/usePolling';

const isDefined = <T,>(value: T | null | undefined): value is T => value != null;
const ANNOTATION_FETCH_DEBOUNCE_MS = 250;

export function useObservabilityData() {
  const fetchObservabilityMetrics = usePersonaStore((s) => s.fetchObservabilityMetrics);
  const observabilityMetrics = usePersonaStore((s) => s.observabilityMetrics);
  const observabilityError = usePersonaStore((s) => s.observabilityError);
  const personas = usePersonaStore((s) => s.personas);
  const healingIssues = usePersonaStore((s) => s.healingIssues);
  const healingRunning = usePersonaStore((s) => s.healingRunning);
  const fetchHealingIssues = usePersonaStore((s) => s.fetchHealingIssues);
  const triggerHealing = usePersonaStore((s) => s.triggerHealing);
  const resolveHealingIssue = usePersonaStore((s) => s.resolveHealingIssue);
  const credentials = usePersonaStore((s) => s.credentials);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);

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
  const [promptAnnotations, setPromptAnnotations] = useState<ChartAnnotationRecord[]>([]);
  const [rotationAnnotations, setRotationAnnotations] = useState<ChartAnnotationRecord[]>([]);

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

  useEffect(() => { initHealingListener(); }, []);
  useEffect(() => { void fetchCredentials(); }, [fetchCredentials]);

  // Load prompt annotations
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timeoutId = setTimeout(() => {
      const loadPromptAnnotations = async () => {
        const personaIds = selectedPersonaId ? [selectedPersonaId] : personas.map((p) => p.id).slice(0, 8);
        if (personaIds.length === 0) {
          if (!signal.aborted) setPromptAnnotations([]);
          return;
        }
        try {
          const byPersona = await Promise.all(
            personaIds.map(async (personaId) => {
              if (signal.aborted) return [];
              const versions = await getPromptVersions(personaId, 8);
              if (signal.aborted) return [];
              return versions.map((version) => {
                const date = toChartDate(version.created_at);
                if (!date) return null;
                return {
                  timestamp: version.created_at, date,
                  label: `Prompt v${version.version_number} (${version.tag})`,
                  type: 'prompt' as const, personaId,
                };
              }).filter(isDefined);
            }),
          );
          if (!signal.aborted) setPromptAnnotations(byPersona.flat());
        } catch {
          if (!signal.aborted) setPromptAnnotations([]);
        }
      };
      void loadPromptAnnotations();
    }, ANNOTATION_FETCH_DEBOUNCE_MS);
    return () => { controller.abort(); clearTimeout(timeoutId); };
  }, [selectedPersonaId, personas]);

  // Load rotation annotations
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timeoutId = setTimeout(() => {
      const loadRotationAnnotations = async () => {
        if (credentials.length === 0) {
          if (!signal.aborted) setRotationAnnotations([]);
          return;
        }
        try {
          const byCredential = await Promise.all(
            credentials.slice(0, 20).map(async (credential) => {
              if (signal.aborted) return [];
              const history = await getRotationHistory(credential.id, 3);
              if (signal.aborted) return [];
              return history.map((entry) => {
                const date = toChartDate(entry.created_at);
                if (!date) return null;
                return {
                  timestamp: entry.created_at, date,
                  label: `Rotation ${entry.status}${credential.name ? ` · ${credential.name}` : ''}`,
                  type: 'rotation' as const, personaId: null,
                };
              }).filter(isDefined);
            }),
          );
          if (!signal.aborted) setRotationAnnotations(byCredential.flat());
        } catch {
          if (!signal.aborted) setRotationAnnotations([]);
        }
      };
      void loadRotationAnnotations();
    }, ANNOTATION_FETCH_DEBOUNCE_MS);
    return () => { controller.abort(); clearTimeout(timeoutId); };
  }, [credentials]);

  const evaluateAlertRules = usePersonaStore((s) => s.evaluateAlertRules);

  // Evaluate alert rules whenever metrics change
  useEffect(() => {
    if (observabilityMetrics) evaluateAlertRules();
  }, [observabilityMetrics, evaluateAlertRules]);

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

  const healingAnnotations = useMemo<ChartAnnotationRecord[]>(() =>
    healingIssues
      .map((issue) => {
        const date = toChartDate(issue.created_at);
        if (!date) return null;
        return {
          timestamp: issue.created_at, date,
          label: issue.is_circuit_breaker ? `Circuit breaker: ${issue.title}` : issue.title,
          type: issue.is_circuit_breaker ? 'incident' as const : 'healing' as const,
          personaId: issue.persona_id,
        };
      })
      .filter(isDefined),
  [healingIssues]);

  const chartAnnotations = useAnnotationComposer(
    [promptAnnotations, rotationAnnotations, healingAnnotations],
    { filterPersonaId: selectedPersonaId },
  );

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
  };
}
