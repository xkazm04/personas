import { useEffect, useState, useMemo, useCallback } from 'react';
import { usePersonaStore, initHealingListener } from '@/stores/personaStore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { DollarSign, Zap, CheckCircle, TrendingUp, TrendingDown, ArrowRight, RefreshCw, Stethoscope, CheckCircle2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import HealingIssueModal from '@/features/overview/sub_observability/HealingIssueModal';
import { DayRangePicker, PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import type { DayRange } from '@/features/overview/sub_usage/DashboardFilters';
import { CHART_COLORS_PURPLE, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { SEVERITY_COLORS, HEALING_CATEGORY_COLORS, badgeClass } from '@/lib/utils/formatters';
import { ChartTooltip } from '@/features/overview/sub_usage/charts/ChartTooltip';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { PersonaMetricsSnapshot } from '@/lib/bindings/PersonaMetricsSnapshot';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';

export default function ObservabilityDashboard() {
  const fetchObservabilityMetrics = usePersonaStore((s) => s.fetchObservabilityMetrics);
  const observabilityMetrics = usePersonaStore((s) => s.observabilityMetrics);
  const personas = usePersonaStore((s) => s.personas);
  const healingIssues = usePersonaStore((s) => s.healingIssues);
  const healingRunning = usePersonaStore((s) => s.healingRunning);
  const fetchHealingIssues = usePersonaStore((s) => s.fetchHealingIssues);
  const triggerHealing = usePersonaStore((s) => s.triggerHealing);
  const resolveHealingIssue = usePersonaStore((s) => s.resolveHealingIssue);
  const [days, setDays] = useState<DayRange>(30);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{
    failures_analyzed: number;
    issues_created: number;
    auto_fixed: number;
  } | null>(null);

  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null);
    const result = await triggerHealing(selectedPersonaId || personas[0]?.id);
    if (result) setAnalysisResult(result);
  }, [triggerHealing, selectedPersonaId, personas]);

  useEffect(() => {
    initHealingListener();
  }, []);

  useEffect(() => {
    Promise.all([
      fetchObservabilityMetrics(days, selectedPersonaId || undefined),
      fetchHealingIssues(),
    ]);
  }, [days, selectedPersonaId, fetchObservabilityMetrics, fetchHealingIssues]);

  const handleRefresh = async () => {
    await Promise.all([
      fetchObservabilityMetrics(days, selectedPersonaId || undefined),
      fetchHealingIssues(),
    ]);
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      Promise.all([
        fetchObservabilityMetrics(days, selectedPersonaId || undefined),
        fetchHealingIssues(),
      ]);
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, days, selectedPersonaId, fetchObservabilityMetrics, fetchHealingIssues]);

  const summary = observabilityMetrics?.summary;
  const timeSeries: PersonaMetricsSnapshot[] = observabilityMetrics?.timeSeries || [];

  // Aggregate time series by date for charts
  const dateMap = new Map<string, { date: string; cost: number; executions: number; success: number; failed: number; tokens: number }>();
  for (const row of timeSeries) {
    const date = row.snapshot_date;
    const existing = dateMap.get(date) || { date, cost: 0, executions: 0, success: 0, failed: 0, tokens: 0 };
    existing.cost += row.total_cost_usd || 0;
    existing.executions += row.total_executions || 0;
    existing.success += row.successful_executions || 0;
    existing.failed += row.failed_executions || 0;
    existing.tokens += (row.total_input_tokens || 0) + (row.total_output_tokens || 0);
    dateMap.set(date, existing);
  }
  const chartData = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Per-persona breakdown for pie chart
  const personaMap = new Map<string, { name: string; executions: number; cost: number }>();
  for (const row of timeSeries) {
    const pid = row.persona_id;
    const personaName = personas.find((p) => p.id === pid)?.name || pid;
    const existing = personaMap.get(pid) || { name: personaName, executions: 0, cost: 0 };
    existing.executions += row.total_executions || 0;
    existing.cost += row.total_cost_usd || 0;
    personaMap.set(pid, existing);
  }
  const pieData = Array.from(personaMap.values()).filter(d => d.executions > 0);

  const successRate = summary && summary.total_executions > 0
    ? ((summary.successful_executions / summary.total_executions) * 100).toFixed(1)
    : '0';

  // Period-over-period trend comparison: split sorted chart data into two halves
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

    const pctChange = (curr: number, prev: number) => prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100;

    // Active personas: count unique persona IDs per half from raw time series
    const prevDates = new Set(prev.map(d => d.date));
    const prevPersonas = new Set(timeSeries.filter(r => prevDates.has(r.snapshot_date) && r.total_executions > 0).map(r => r.persona_id));
    const currDates = new Set(curr.map(d => d.date));
    const currPersonas = new Set(timeSeries.filter(r => currDates.has(r.snapshot_date) && r.total_executions > 0).map(r => r.persona_id));

    return {
      cost: { pct: pctChange(currCost, prevCost), invertColor: true },
      executions: { pct: pctChange(currExec, prevExec), invertColor: false },
      successRate: { pct: currRate - prevRate, invertColor: false },
      personas: { pct: pctChange(currPersonas.size, prevPersonas.size), invertColor: false },
    };
  }, [chartData, timeSeries]);

  // Issue counts and filtered/sorted list
  const issueCounts = useMemo(() => {
    const open = healingIssues.filter((i) => !i.auto_fixed).length;
    const autoFixed = healingIssues.filter((i) => i.auto_fixed).length;
    return { all: healingIssues.length, open, autoFixed };
  }, [healingIssues]);

  const sortedFilteredIssues = useMemo(() => {
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const filtered = issueFilter === 'all'
      ? healingIssues
      : issueFilter === 'open'
        ? healingIssues.filter((i) => !i.auto_fixed)
        : healingIssues.filter((i) => i.auto_fixed);

    return [...filtered].sort((a, b) => {
      // Auto-fixed always sink to bottom
      if (a.auto_fixed !== b.auto_fixed) return a.auto_fixed ? 1 : -1;
      // Then by severity
      return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    });
  }, [healingIssues, issueFilter]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground/90">Observability</h1>
          <p className="text-sm text-muted-foreground/50 mt-0.5">Performance metrics, cost tracking, execution health</p>
        </div>
        <div className="flex items-center gap-3">
          <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
          <DayRangePicker value={days} onChange={setDays} />
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg border border-primary/15 text-muted-foreground/50 hover:text-foreground/70 hover:bg-secondary/40 transition-colors"
            title="Refresh metrics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {/* Auto-refresh */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1.5 rounded-lg border transition-colors ${
              autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/50'
            }`}
            title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} style={autoRefresh ? { animationDuration: '3s' } : {}} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={DollarSign} label="Total Cost" numericValue={summary?.total_cost_usd || 0} format={(n) => `$${n.toFixed(2)}`} color="emerald" trend={trends.cost} sparklineData={chartData.slice(-7).map((d) => d.cost)} />
        <SummaryCard icon={Zap} label="Executions" numericValue={summary?.total_executions || 0} format={(n) => String(Math.round(n))} color="blue" trend={trends.executions} sparklineData={chartData.slice(-7).map((d) => d.executions)} />
        <SummaryCard icon={CheckCircle} label="Success Rate" numericValue={parseFloat(successRate)} format={(n) => `${n.toFixed(1)}%`} color="green" trend={trends.successRate} sparklineData={chartData.slice(-7).map((d) => { const total = d.success + d.failed; return total > 0 ? (d.success / total) * 100 : 0; })} />
        <SummaryCard icon={TrendingUp} label="Active Personas" numericValue={summary?.active_personas || 0} format={(n) => String(Math.round(n))} color="purple" trend={trends.personas} sparklineData={chartData.slice(-7).map((d) => { const personas = new Set(timeSeries.filter((r) => r.snapshot_date === d.date && r.total_executions > 0).map((r) => r.persona_id)); return personas.size; })} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-2 gap-6">
        {/* Cost Over Time */}
        <div className="bg-secondary/30 border border-primary/15 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground/80 mb-3">Cost Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => `$${v}`} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="cost" stroke="#6366f1" fill="url(#costGradient)" strokeWidth={2} />
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Execution Distribution */}
        <div className="bg-secondary/30 border border-primary/15 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground/80 mb-3">Executions by Persona</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="executions" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${String(name ?? '')} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS_PURPLE[i % CHART_COLORS_PURPLE.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground/40">No execution data</div>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="bg-secondary/30 border border-primary/15 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-foreground/80 mb-3">Execution Health</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
            <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="success" name="Successful" fill="#22c55e" radius={[2, 2, 0, 0]} />
            <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Health Issues Section */}
      <div className="rounded-2xl border border-primary/15 bg-secondary/30 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10 bg-primary/5">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-foreground/80">Health Issues</h3>
            {healingIssues.length > 0 && (
              <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {healingIssues.length}
              </span>
            )}
          </div>
          <button
            onClick={handleRunAnalysis}
            disabled={healingRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {healingRunning ? (
              <>
                <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Stethoscope className="w-3.5 h-3.5" />
                Run Analysis
              </>
            )}
          </button>
        </div>

        {/* Analysis Result Summary */}
        {analysisResult && !healingRunning && (
          <div className="flex items-center justify-between px-5 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs text-cyan-300">
                Analysis complete: {analysisResult.issues_created} issue{analysisResult.issues_created !== 1 ? 's' : ''} found
                {analysisResult.auto_fixed > 0 && ` (${analysisResult.auto_fixed} auto-fixed)`}
                , {analysisResult.failures_analyzed} execution{analysisResult.failures_analyzed !== 1 ? 's' : ''} scanned
              </span>
            </div>
            <button
              onClick={() => setAnalysisResult(null)}
              className="p-1 rounded hover:bg-cyan-500/20 text-cyan-400/50 hover:text-cyan-300 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Issues Summary */}
        {healingIssues.length > 0 && <HealingIssueSummary issues={healingIssues} />}

        {/* Filter Chips */}
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
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  issueFilter === chip.key
                    ? 'bg-background text-foreground shadow-sm border border-primary/20'
                    : 'text-muted-foreground/60 hover:text-muted-foreground'
                }`}
              >
                {chip.label}
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                  issueFilter === chip.key
                    ? 'bg-primary/15 text-foreground/70'
                    : 'bg-secondary/60 text-muted-foreground/40'
                }`}>
                  {chip.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Issues List */}
        {healingIssues.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <div className="text-center">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400/40" />
              <p className="text-sm text-muted-foreground/50">No open issues</p>
              <p className="text-xs text-muted-foreground/30 mt-1">Run analysis to check for problems</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-primary/10">
            {sortedFilteredIssues.map((issue: PersonaHealingIssue) => {
              const sevBadge = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.medium!;
              const age = Math.floor((Date.now() - new Date(issue.created_at).getTime()) / (1000 * 60 * 60));
              const ageLabel = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;

              const isAutoFixed = issue.auto_fixed;

              return (
                <div key={issue.id} className={`flex items-center gap-3 px-5 py-3 hover:bg-secondary/40 transition-colors ${isAutoFixed ? 'opacity-70' : ''}`}>
                  {isAutoFixed ? (
                    <span className="inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded-md border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
                      fixed
                    </span>
                  ) : (
                    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded-md ${badgeClass(sevBadge)}`}>
                      {issue.severity}
                    </span>
                  )}
                  <button
                    onClick={() => setSelectedIssue(issue)}
                    className={`flex-1 text-left text-sm transition-colors line-clamp-2 ${isAutoFixed ? 'text-foreground/50 line-through decoration-emerald-500/30' : 'text-foreground/80 hover:text-foreground'}`}
                  >
                    {issue.title}
                  </button>
                  <span className={`text-[11px] font-mono min-w-[90px] text-right ${HEALING_CATEGORY_COLORS[issue.category]?.text || 'text-muted-foreground/40'}`}>
                    {issue.category}
                  </span>
                  <span className="text-[11px] text-muted-foreground/30 w-16 text-right">{ageLabel}</span>
                  {!isAutoFixed && (
                    <button
                      onClick={() => resolveHealingIssue(issue.id)}
                      className="px-2 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/10 rounded-md transition-colors"
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

      {/* Healing Issue Detail Modal */}
      {selectedIssue && (
        <HealingIssueModal
          issue={selectedIssue}
          onResolve={(id) => { resolveHealingIssue(id); setSelectedIssue(null); }}
          onClose={() => setSelectedIssue(null)}
        />
      )}
    </div>
  );
}

function HealingIssueSummary({ issues }: { issues: PersonaHealingIssue[] }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    const openIssues = issues.filter((i) => i.status !== 'resolved');
    const autoFixedThisWeek = issues.filter(
      (i) => i.auto_fixed && new Date(i.created_at).getTime() >= weekAgo,
    );

    // Recurring categories in the last 7 days
    const recentCategoryCounts = new Map<string, number>();
    for (const issue of issues) {
      if (new Date(issue.created_at).getTime() >= weekAgo) {
        recentCategoryCounts.set(issue.category, (recentCategoryCounts.get(issue.category) || 0) + 1);
      }
    }
    const recurring = Array.from(recentCategoryCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    // Trend: compare issues created this week vs last week
    const thisWeekCount = issues.filter(
      (i) => new Date(i.created_at).getTime() >= weekAgo,
    ).length;
    const lastWeekCount = issues.filter((i) => {
      const t = new Date(i.created_at).getTime();
      return t >= twoWeeksAgo && t < weekAgo;
    }).length;

    let trend: 'improving' | 'worsening' | 'stable' = 'stable';
    if (thisWeekCount < lastWeekCount) trend = 'improving';
    else if (thisWeekCount > lastWeekCount) trend = 'worsening';

    return { openIssues: openIssues.length, autoFixedThisWeek: autoFixedThisWeek.length, recurring, trend, thisWeekCount, lastWeekCount };
  }, [issues]);

  const TrendIcon = stats.trend === 'improving' ? TrendingDown : stats.trend === 'worsening' ? TrendingUp : ArrowRight;
  const trendColor = stats.trend === 'improving' ? 'text-emerald-400' : stats.trend === 'worsening' ? 'text-red-400' : 'text-muted-foreground/50';
  const trendBg = stats.trend === 'improving' ? 'bg-emerald-500/10' : stats.trend === 'worsening' ? 'bg-red-500/10' : 'bg-secondary/40';
  const trendLabel = stats.trend === 'improving' ? 'Improving' : stats.trend === 'worsening' ? 'Worsening' : 'Stable';

  return (
    <div className="px-5 py-3 border-b border-primary/10 bg-secondary/20">
      <div className="flex items-center gap-4 flex-wrap text-[11px]">
        {/* Open issues */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground/70">{stats.openIssues}</span>
          <span className="text-muted-foreground/50">open</span>
        </div>

        <span className="text-primary/15">|</span>

        {/* Auto-fixed this week */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-emerald-400">{stats.autoFixedThisWeek}</span>
          <span className="text-muted-foreground/50">auto-fixed this week</span>
        </div>

        <span className="text-primary/15">|</span>

        {/* Trend */}
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md ${trendBg}`}>
          <TrendIcon className={`w-3 h-3 ${trendColor}`} />
          <span className={`font-medium ${trendColor}`}>{trendLabel}</span>
        </div>

        {/* Recurring patterns */}
        {stats.recurring.length > 0 && (
          <>
            <span className="text-primary/15">|</span>
            {stats.recurring.map(([category, count]) => (
              <span key={category} className="text-amber-400/80">
                {count} {category} issues in 7d
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface TrendData {
  /** Percentage change (positive = increase, negative = decrease) */
  pct: number;
  /** If true, a decrease is good (green) and increase is bad (red) — e.g. cost */
  invertColor: boolean;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 32;
  const h = 16;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="mt-1" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SPARKLINE_HEX: Record<string, string> = {
  emerald: '#10b981',
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
};

function SummaryCard({ icon: Icon, label, numericValue, format, color, trend, sparklineData }: { icon: LucideIcon; label: string; numericValue: number; format: (n: number) => string; color: string; trend?: TrendData | null; sparklineData?: number[] }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
  };
  const cls = colorMap[color] || colorMap.blue;
  const animated = useAnimatedNumber(numericValue);

  const trendDisplay = useMemo(() => {
    if (!trend || (trend.pct === 0)) return null;
    const isUp = trend.pct > 0;
    const isGood = trend.invertColor ? !isUp : isUp;
    const TIcon = isUp ? TrendingUp : TrendingDown;
    const trendColor = isGood ? 'text-emerald-400' : 'text-red-400';
    const absPct = Math.abs(trend.pct);
    const label = absPct >= 1000 ? '999+%' : absPct < 0.1 ? '<0.1%' : `${absPct.toFixed(1)}%`;
    return { TIcon, trendColor, label };
  }, [trend]);

  return (
    <div className="bg-secondary/30 border border-primary/15 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${cls}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-xs text-muted-foreground/60">{label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{format(animated)}</div>
      {sparklineData && sparklineData.length >= 2 && (
        <Sparkline data={sparklineData} color={SPARKLINE_HEX[color] || '#3b82f6'} />
      )}
      {trendDisplay && (
        <div className={`flex items-center gap-1 mt-1.5 text-[11px] ${trendDisplay.trendColor}`}>
          <trendDisplay.TIcon className="w-3 h-3" />
          <span>{trendDisplay.label}</span>
          <span className="text-muted-foreground/30 ml-0.5">vs prev</span>
        </div>
      )}
    </div>
  );
}
