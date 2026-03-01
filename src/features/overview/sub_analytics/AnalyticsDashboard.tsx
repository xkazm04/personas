import { useEffect, useState, useMemo, useCallback } from 'react';
import { usePersonaStore, initHealingListener } from '@/stores/personaStore';
import {
  DollarSign, Zap, CheckCircle, TrendingUp, RefreshCw,
  Stethoscope, CheckCircle2, X, AlertTriangle, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { getAllMonthlySpend } from '@/api/observability';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import HealingIssueModal from '@/features/overview/sub_observability/HealingIssueModal';
import { DayRangePicker, PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import type { DayRange } from '@/features/overview/sub_usage/DashboardFilters';
import { MetricChart } from '@/features/overview/sub_usage/charts/MetricChart';
import { ChartTooltip } from '@/features/overview/sub_usage/charts/ChartTooltip';
import { CHART_COLORS, CHART_COLORS_PURPLE, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { SEVERITY_COLORS, HEALING_CATEGORY_COLORS, badgeClass } from '@/lib/utils/formatters';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { PieDataPoint } from '@/features/overview/sub_observability/MetricsCharts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalyticsDashboard() {
  // ── Observability store ──
  const fetchObservabilityMetrics = usePersonaStore((s) => s.fetchObservabilityMetrics);
  const observabilityMetrics = usePersonaStore((s) => s.observabilityMetrics);
  const observabilityError = usePersonaStore((s) => s.observabilityError);
  const healingIssues = usePersonaStore((s) => s.healingIssues);
  const healingRunning = usePersonaStore((s) => s.healingRunning);
  const fetchHealingIssues = usePersonaStore((s) => s.fetchHealingIssues);
  const triggerHealing = usePersonaStore((s) => s.triggerHealing);
  const resolveHealingIssue = usePersonaStore((s) => s.resolveHealingIssue);

  // ── Tool usage store ──
  const toolUsageSummary = usePersonaStore((s) => s.toolUsageSummary);
  const toolUsageOverTime = usePersonaStore((s) => s.toolUsageOverTime);
  const fetchToolUsage = usePersonaStore((s) => s.fetchToolUsage);

  const personas = usePersonaStore((s) => s.personas);

  // ── Shared filter state ──
  const [days, setDays] = useState<DayRange>(30);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  // ── Healing state ──
  const [selectedIssue, setSelectedIssue] = useState<PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{
    failures_analyzed: number;
    issues_created: number;
    auto_fixed: number;
  } | null>(null);

  // ── Budget state ──
  const [budgetData, setBudgetData] = useState<Array<{ personaId: string; name: string; spend: number; budget: number | null }>>([]);

  const budgetWarnings = useMemo(() => {
    return budgetData.filter((d) => d.budget && d.budget > 0 && d.spend >= d.budget * 0.8);
  }, [budgetData]);

  // ── Data fetching ──
  const refreshAll = useCallback(() => {
    return Promise.all([
      fetchObservabilityMetrics(days, selectedPersonaId || undefined),
      fetchToolUsage(days, selectedPersonaId || undefined),
      fetchHealingIssues(),
      getAllMonthlySpend().then((data) => {
        setBudgetData(data.map((d) => ({ personaId: d.id, name: d.name, spend: d.spend, budget: d.max_budget_usd })));
      }).catch(() => {}),
    ]);
  }, [days, selectedPersonaId, fetchObservabilityMetrics, fetchToolUsage, fetchHealingIssues]);

  useEffect(() => { initHealingListener(); }, []);
  useEffect(() => { refreshAll(); }, [refreshAll]);
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(refreshAll, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshAll]);

  // ── Observability metrics ──
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

  // ── Tool usage chart data ──
  const { areaData, allToolNames } = useMemo(() => {
    if (!toolUsageOverTime.length) return { areaData: [], allToolNames: [] as string[] };
    const dateMap = new Map<string, Record<string, number>>();
    const names = new Set<string>();
    for (const row of toolUsageOverTime) {
      names.add(row.tool_name);
      if (!dateMap.has(row.date)) dateMap.set(row.date, {});
      const entry = dateMap.get(row.date)!;
      entry[row.tool_name] = (entry[row.tool_name] || 0) + row.invocations;
    }
    const sortedDates = Array.from(dateMap.keys()).sort();
    return {
      areaData: sortedDates.map(date => ({ date, ...dateMap.get(date) })),
      allToolNames: Array.from(names),
    };
  }, [toolUsageOverTime]);

  // Bar chart: horizontal bars for tool invocations
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

  // ── Issue management ──
  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null);
    const result = await triggerHealing(selectedPersonaId || personas[0]?.id);
    if (result) setAnalysisResult(result);
  }, [triggerHealing, selectedPersonaId, personas]);

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

  return (
    <ContentBox>
      <ContentHeader
        icon={<BarChart3 className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Analytics"
        subtitle="Unified cost, execution, and tool usage analytics"
        actions={
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Header badges */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
              <DollarSign className="w-3 h-3" />${(summary?.total_cost_usd || 0).toFixed(2)}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border bg-blue-500/10 border-blue-500/20 text-blue-300">
              <Zap className="w-3 h-3" />{summary?.total_executions || 0}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border bg-green-500/10 border-green-500/20 text-green-300">
              <CheckCircle className="w-3 h-3" />{successRate}%
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border bg-purple-500/10 border-purple-500/20 text-purple-300">
              <TrendingUp className="w-3 h-3" />{summary?.active_personas || 0}
            </span>
            <button
              onClick={refreshAll}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`p-1.5 rounded-lg border transition-colors ${
                autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/90'
              }`}
              title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} style={autoRefresh ? { animationDuration: '3s' } : {}} />
            </button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-4 flex-wrap flex-shrink-0">
        <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
        <DayRangePicker value={days} onChange={setDays} />
      </div>

      <ContentBody>
        <div className="space-y-4">

          {/* Error banner */}
          {observabilityError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300">Metrics unavailable</p>
                  <p className="text-sm text-red-400/70 mt-0.5">{observabilityError}</p>
                </div>
                <button onClick={refreshAll} className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-lg bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              </div>
            </div>
          )}

          {/* Budget warnings */}
          {budgetWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    {budgetWarnings.length === 1 ? '1 persona' : `${budgetWarnings.length} personas`} approaching or exceeding budget
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {budgetWarnings.map((w) => {
                      const ratio = w.budget! > 0 ? w.spend / w.budget! : 0;
                      const exceeded = ratio >= 1;
                      return (
                        <span key={w.personaId} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm border ${exceeded ? 'bg-red-500/15 text-red-300 border-red-500/25' : 'bg-amber-500/15 text-amber-300 border-amber-500/25'}`}>
                          {w.name}
                          <span className="font-mono text-sm opacity-80">${w.spend.toFixed(2)} / ${w.budget!.toFixed(2)}</span>
                          <span className={`font-mono text-sm font-bold ${exceeded ? 'text-red-400' : 'text-amber-400'}`}>{(ratio * 100).toFixed(0)}%</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Charts — 2 column grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cost Over Time */}
            <MetricChart title="Cost Over Time" height={180}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="cost" stroke="#6366f1" fill="url(#analyticsCostGrad)" strokeWidth={2} />
                <defs>
                  <linearGradient id="analyticsCostGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
              </AreaChart>
            </MetricChart>

            {/* Execution Health */}
            <MetricChart title="Execution Health" height={180}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} />
                <Tooltip content={<ChartTooltip />} cursor={false} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="success" name="Successful" fill="#22c55e" radius={[2, 2, 0, 0]} />
                <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[2, 2, 0, 0]} />
              </BarChart>
            </MetricChart>

            {/* Tool Usage Over Time */}
            {areaData.length > 0 && (
              <MetricChart title="Tool Usage Over Time" height={180}>
                <AreaChart data={areaData} margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                  <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  {allToolNames.map((toolName, idx) => (
                    <Area key={toolName} type="monotone" dataKey={toolName} name={formatToolName(toolName)} stackId="1" fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.3} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={1.5} />
                  ))}
                </AreaChart>
              </MetricChart>
            )}

            {/* Executions by Persona (donut) */}
            <MetricChart
              title="Executions by Persona"
              height={180}
              emptySlot={pieData.length === 0 ? (
                <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground/80">No execution data</div>
              ) : undefined}
            >
              <PieChart>
                <Pie data={pieData} dataKey="executions" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} stroke="none">
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS_PURPLE[i % CHART_COLORS_PURPLE.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend verticalAlign="bottom" iconType="circle" iconSize={8} formatter={(value: string) => (
                  <span className="text-sm text-foreground/90">{value}</span>
                )} />
              </PieChart>
            </MetricChart>
          </div>

          {/* Tool Invocations — full width horizontal bar */}
          {barData.length > 0 && (
            <MetricChart title="Tool Invocations" height={Math.max(200, barData.length * 40)}>
              <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                <XAxis type="number" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" width={120} tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="invocations" name="Invocations" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </MetricChart>
          )}

          {/* Health Issues — full width */}
          <div className="rounded-2xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-primary/5 bg-gradient-to-r from-secondary/40 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 shadow-inner flex items-center justify-center">
                  <Stethoscope className="w-4 h-4 text-cyan-400" />
                </div>
                <h3 className="text-sm font-bold text-foreground/90 uppercase tracking-widest">Health Issues</h3>
                {healingIssues.length > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-black tracking-wide rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                    {healingIssues.length}
                  </span>
                )}
              </div>
              <button
                onClick={handleRunAnalysis}
                disabled={healingRunning}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-br from-cyan-500/15 to-transparent border border-cyan-500/20 text-cyan-300 hover:from-cyan-500/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {healingRunning ? (
                  <><div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />Analyzing...</>
                ) : (
                  <><Stethoscope className="w-4 h-4" />Run Analysis</>
                )}
              </button>
            </div>

            {/* Analysis result */}
            {analysisResult && !healingRunning && (
              <div className="flex items-center justify-between px-5 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-sm text-cyan-300">
                    Analysis complete: {analysisResult.issues_created} issue{analysisResult.issues_created !== 1 ? 's' : ''} found
                    {analysisResult.auto_fixed > 0 && ` (${analysisResult.auto_fixed} auto-fixed)`}
                    , {analysisResult.failures_analyzed} execution{analysisResult.failures_analyzed !== 1 ? 's' : ''} scanned
                  </span>
                </div>
                <button onClick={() => setAnalysisResult(null)} className="p-1 rounded hover:bg-cyan-500/20 text-cyan-400/50 hover:text-cyan-300 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Filter chips */}
            {healingIssues.length > 0 && (
              <div className="px-5 py-2.5 border-b border-primary/10 flex items-center gap-1">
                {([
                  { key: 'all' as const, label: 'All', count: issueCounts.all },
                  { key: 'open' as const, label: 'Open', count: issueCounts.open },
                  { key: 'auto-fixed' as const, label: 'Auto-fixed', count: issueCounts.autoFixed },
                ]).map((chip) => (
                  <button
                    key={chip.key}
                    onClick={() => setIssueFilter(chip.key)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                      issueFilter === chip.key
                        ? 'bg-background text-foreground shadow-sm border border-primary/20'
                        : 'text-muted-foreground/80 hover:text-muted-foreground'
                    }`}
                  >
                    {chip.label}
                    <span className={`px-1.5 py-0.5 text-sm font-bold rounded-full ${
                      issueFilter === chip.key ? 'bg-primary/15 text-foreground/90' : 'bg-secondary/60 text-muted-foreground/80'
                    }`}>{chip.count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Issues list */}
            {healingIssues.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <div className="text-center flex flex-col items-center">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner flex items-center justify-center mb-4 opacity-70">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium text-foreground/80">No open issues</p>
                  <p className="text-xs text-muted-foreground mt-1">Run analysis to check for problems.</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-primary/5 bg-gradient-to-b from-transparent to-black/[0.02]">
                {sortedFilteredIssues.map((issue: PersonaHealingIssue) => {
                  const sevBadge = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.medium!;
                  const age = Math.floor((Date.now() - new Date(issue.created_at).getTime()) / (1000 * 60 * 60));
                  const ageLabel = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
                  const isAutoFixed = issue.auto_fixed;
                  const isCircuitBreaker = /circuit\s*breaker/i.test(issue.title);

                  return (
                    <div key={issue.id} className={`flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors group cursor-pointer ${isAutoFixed ? 'opacity-70' : ''} ${isCircuitBreaker ? 'bg-red-500/5' : ''}`}>
                      {isCircuitBreaker ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono uppercase rounded-md border bg-red-500/15 text-red-400 border-red-500/25">
                          <Zap className="w-3 h-3" />breaker
                        </span>
                      ) : isAutoFixed ? (
                        <span className="inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded-md border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">fixed</span>
                      ) : (
                        <span className={`inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded-md ${badgeClass(sevBadge)}`}>{issue.severity}</span>
                      )}
                      {isAutoFixed && issue.execution_id && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title="Auto-healed via retry">
                          <RefreshCw className="w-2.5 h-2.5" />retry
                        </span>
                      )}
                      <button
                        onClick={() => setSelectedIssue(issue)}
                        className={`flex-1 text-left text-sm transition-colors line-clamp-2 ${isCircuitBreaker ? 'text-red-400/90 hover:text-red-300 font-medium' : isAutoFixed ? 'text-foreground/90 line-through decoration-emerald-500/30' : 'text-foreground/80 hover:text-foreground'}`}
                      >
                        {issue.title}
                      </button>
                      <span className={`text-sm font-mono min-w-[90px] text-right ${HEALING_CATEGORY_COLORS[issue.category]?.text || 'text-muted-foreground/80'}`}>
                        {issue.category}
                      </span>
                      <span className="text-sm text-muted-foreground/80 w-16 text-right">{ageLabel}</span>
                      {!isAutoFixed && (
                        <button
                          onClick={() => resolveHealingIssue(issue.id)}
                          className="px-2 py-1 text-sm font-medium text-emerald-400 hover:bg-emerald-500/10 rounded-md transition-colors"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </ContentBody>

      {/* Healing modal */}
      {selectedIssue && (
        <HealingIssueModal
          issue={selectedIssue}
          onResolve={(id) => { resolveHealingIssue(id); setSelectedIssue(null); }}
          onClose={() => setSelectedIssue(null)}
        />
      )}
    </ContentBox>
  );
}
