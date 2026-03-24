import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { DollarSign, Zap, CheckCircle, TrendingUp, RefreshCw, BarChart3 } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import HealingIssueModal from '@/features/overview/sub_observability/components/HealingIssueModal';
import { DayRangePicker, PersonaSelect, CompareToggle } from '@/features/overview/sub_usage/DashboardFilters';
import { mergePreviousPeriod } from '@/features/overview/sub_usage/charts/periodComparison';
import { pivotToolUsageOverTime } from '@/features/overview/sub_usage/charts/pivotToolUsage';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import type { PieDataPoint } from '@/features/overview/sub_observability/components/MetricsCharts';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { MetricsChartPoint } from '@/lib/bindings/MetricsChartPoint';
import { ErrorBanner, CostAnomalyAlerts } from './AnalyticsDashboardAlerts';
import { AnalyticsDashboardCharts } from './AnalyticsDashboardCharts';
import { AnalyticsDashboardHealthPanel } from './AnalyticsDashboardHealthPanel';
import { formatDateTick } from './libs/analyticsHelpers';

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function AnalyticsDashboard() {
  const fetchObservabilityMetrics = useOverviewStore((s) => s.fetchObservabilityMetrics);
  const observabilityMetrics = useOverviewStore((s) => s.observabilityMetrics);
  const observabilityError = useOverviewStore((s) => s.observabilityError);
  const healingIssues = useOverviewStore((s) => s.healingIssues);
  const healingRunning = useOverviewStore((s) => s.healingRunning);
  const fetchHealingIssues = useOverviewStore((s) => s.fetchHealingIssues);
  const triggerHealing = useOverviewStore((s) => s.triggerHealing);
  const resolveHealingIssue = useOverviewStore((s) => s.resolveHealingIssue);
  const executionDashboard = useOverviewStore((s) => s.executionDashboard);
  const fetchExecutionDashboard = useOverviewStore((s) => s.fetchExecutionDashboard);
  const toolUsageSummary = useAgentStore((s) => s.toolUsageSummary);
  const toolUsageOverTime = useAgentStore((s) => s.toolUsageOverTime);
  const fetchToolUsage = useAgentStore((s) => s.fetchToolUsage);
  const personas = useAgentStore((s) => s.personas);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  const {
    dayRange: days, setDayRange: setDays, selectedPersonaId, setSelectedPersonaId,
    setFailureDrilldownDate, customDateRange, setCustomDateRange,
    effectiveDays, compareEnabled, setCompareEnabled, previousPeriodDays,
  } = useOverviewFilters();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{ failures_analyzed: number; issues_created: number; auto_fixed: number } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);

  // -- Data fetching --
  const fetchDays = compareEnabled ? previousPeriodDays : effectiveDays;
  const refreshAll = useCallback(() => Promise.all([
    fetchObservabilityMetrics(fetchDays, selectedPersonaId || undefined),
    fetchExecutionDashboard(fetchDays),
    fetchToolUsage(effectiveDays, selectedPersonaId || undefined),
    fetchHealingIssues(),
  ]), [fetchDays, effectiveDays, selectedPersonaId, fetchObservabilityMetrics, fetchExecutionDashboard, fetchToolUsage, fetchHealingIssues]);

  const refreshAllSafe = useCallback(async () => {
    if (refreshInFlightRef.current) { refreshQueuedRef.current = true; await refreshInFlightRef.current; return; }
    const run = (async () => { do { refreshQueuedRef.current = false; await refreshAll(); } while (refreshQueuedRef.current); })();
    refreshInFlightRef.current = run;
    try { await run; } finally { if (refreshInFlightRef.current === run) refreshInFlightRef.current = null; }
  }, [refreshAll]);

  useEffect(() => { void refreshAllSafe(); }, [refreshAllSafe]);
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => { void refreshAllSafe(); }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshAllSafe]);

  // -- Derived data --
  const summary = observabilityMetrics?.summary;
  const rawChartData = observabilityMetrics?.chartData?.chart_points ?? [];
  const chartData = useMemo(() => {
    const base = (!compareEnabled || rawChartData.length === 0) ? rawChartData : mergePreviousPeriod(rawChartData, effectiveDays, ['cost', 'executions', 'success', 'failed']);
    return base.map(pt => ({ ...pt, dateLabel: formatDateTick(pt.date) }));
  }, [compareEnabled, rawChartData, effectiveDays]);

  const pieData: PieDataPoint[] = useMemo(() =>
    (observabilityMetrics?.chartData?.persona_breakdown ?? []).map((b) => ({
      name: personas.find((p) => p.id === b.persona_id)?.name || b.persona_id,
      executions: b.executions, cost: b.cost,
    })), [observabilityMetrics?.chartData?.persona_breakdown, personas]);

  const successRate = resolveMetricPercent(SUCCESS_RATE_IDENTITIES.analyticsSummary, { numerator: summary?.successful_executions ?? 0, denominator: summary?.total_executions ?? 0 }).toFixed(1);
  const { areaData, allToolNames } = useMemo(() => {
    const pivot = pivotToolUsageOverTime(toolUsageOverTime);
    return { areaData: pivot.areaData.map(pt => ({ ...pt, dateLabel: formatDateTick(pt.date) })), allToolNames: pivot.allToolNames };
  }, [toolUsageOverTime]);
  const barData = useMemo(() => [...toolUsageSummary].sort((a, b) => b.total_invocations - a.total_invocations).map((s) => ({ name: formatToolName(s.tool_name), invocations: s.total_invocations, executions: s.unique_executions, personas: s.unique_personas })), [toolUsageSummary]);
  const latencyData = useMemo(() => executionDashboard ? executionDashboard.daily_points.map((pt) => ({ date: pt.date, dateLabel: formatDateTick(pt.date), p50: pt.p50_duration_ms, p95: pt.p95_duration_ms, p99: pt.p99_duration_ms })) : [], [executionDashboard]);
  const costAnomalies = executionDashboard?.cost_anomalies ?? [];

  // -- Callbacks --
  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null); setAnalysisError(null);
    const targetPersonaId = selectedPersonaId || personas[0]?.id;
    if (!targetPersonaId) { setAnalysisError('No persona available for analysis. Create a persona first.'); return; }
    try { const result = await triggerHealing(targetPersonaId); if (result) setAnalysisResult(result); }
    catch (err) { setAnalysisError(err instanceof Error ? err.message : 'Failed to run analysis. Please retry.'); }
  }, [triggerHealing, selectedPersonaId, personas]);

  const handleFailureBarClick = useCallback((data: MetricsChartPoint) => {
    if (!data.date || data.failed === 0) return;
    setFailureDrilldownDate(data.date); setOverviewTab('knowledge');
  }, [setFailureDrilldownDate, setOverviewTab]);

  const { issueCounts, sortedFilteredIssues } = useMemo(() => {
    let open = 0, autoFixed = 0;
    for (const i of healingIssues) { if (i.auto_fixed) autoFixed++; else open++; }
    const counts = { all: healingIssues.length, open, autoFixed };
    const filtered = issueFilter === 'all' ? healingIssues : issueFilter === 'open' ? healingIssues.filter(i => !i.auto_fixed) : healingIssues.filter(i => i.auto_fixed);
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...filtered].sort((a, b) => { if (a.auto_fixed !== b.auto_fixed) return a.auto_fixed ? 1 : -1; return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99); });
    return { issueCounts: counts, sortedFilteredIssues: sorted };
  }, [healingIssues, issueFilter]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<BarChart3 className="w-5 h-5 text-violet-400" />} iconColor="violet"
        title="Analytics" subtitle="Unified cost, execution, and tool usage analytics"
        actions={
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300"><DollarSign className="w-3 h-3" />${(summary?.total_cost_usd || 0).toFixed(2)}</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-blue-500/10 border-blue-500/20 text-blue-300"><Zap className="w-3 h-3" />{summary?.total_executions || 0}</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-green-500/10 border-green-500/20 text-green-300"><CheckCircle className="w-3 h-3" />{successRate}%</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-purple-500/10 border-purple-500/20 text-purple-300"><TrendingUp className="w-3 h-3" />{summary?.active_personas || 0}</span>
            <button onClick={() => { void refreshAllSafe(); }} className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
            <button onClick={() => setAutoRefresh(!autoRefresh)} className={`p-1.5 rounded-lg border transition-colors ${autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/90'}`} title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}><RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} style={autoRefresh ? { animationDuration: '3s' } : {}} /></button>
          </div>
        }
      />
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-4 flex-wrap flex-shrink-0">
        <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
        <DayRangePicker value={days} onChange={setDays} customDateRange={customDateRange} onCustomDateRangeChange={setCustomDateRange} />
        <CompareToggle enabled={compareEnabled} onChange={setCompareEnabled} />
      </div>
      <ContentBody>
        <div className="space-y-4">
          {observabilityError && <ErrorBanner error={observabilityError} onRetry={() => { void refreshAllSafe(); }} />}
          <CostAnomalyAlerts anomalies={costAnomalies} />
          <AnalyticsDashboardCharts chartData={chartData} compareEnabled={compareEnabled} areaData={areaData} allToolNames={allToolNames} pieData={pieData} latencyData={latencyData} barData={barData} handleFailureBarClick={handleFailureBarClick} />
          <AnalyticsDashboardHealthPanel healingIssues={healingIssues} healingRunning={healingRunning} sortedFilteredIssues={sortedFilteredIssues} issueFilter={issueFilter} setIssueFilter={setIssueFilter} issueCounts={issueCounts} analysisResult={analysisResult} analysisError={analysisError} setAnalysisResult={setAnalysisResult} setAnalysisError={setAnalysisError} handleRunAnalysis={handleRunAnalysis} resolveHealingIssue={resolveHealingIssue} onSelectIssue={setSelectedIssue} />
        </div>
      </ContentBody>
      {selectedIssue && <HealingIssueModal issue={selectedIssue} onResolve={(id) => { resolveHealingIssue(id); setSelectedIssue(null); }} onClose={() => setSelectedIssue(null)} />}
    </ContentBox>
  );
}
