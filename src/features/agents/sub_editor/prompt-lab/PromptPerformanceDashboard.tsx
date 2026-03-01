import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import {
  BarChart3, Loader2, AlertTriangle, TrendingUp,
  GitBranch, Layers, RefreshCw, Calendar,
} from 'lucide-react';
import { getPromptPerformance } from '@/api/observability';
import type { PromptPerformanceData } from '@/lib/bindings/PromptPerformanceData';
import type { PromptPerformancePoint } from '@/lib/bindings/PromptPerformancePoint';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import { GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';

// ─── Constants ───────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [7, 14, 30, 60, 90] as const;

const VERSION_COLORS: Record<string, string> = {
  production: '#10b981',
  experimental: '#f59e0b',
  archived: '#71717a',
};

const COMPARE_A_COLOR = '#6366f1';
const COMPARE_B_COLOR = '#ec4899';

const ANOMALY_LABEL: Record<string, string> = {
  cost: 'Cost spike',
  error_rate: 'Error spike',
  latency: 'Latency spike',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtCost(v: number) {
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function fmtMs(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TipEntry { name: string; value: number; color: string; dataKey: string }

function DashTooltip({
  active, payload, label, formatter,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string;
  formatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 backdrop-blur border border-foreground/10 rounded-xl shadow-2xl px-4 py-3 max-w-xs">
      {label && <p className="text-xs text-muted-foreground/80 mb-1.5">{fmtDate(label)}</p>}
      {payload.map((e, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
          <span className="text-foreground/80">{e.name}:</span>
          <span className="text-foreground font-medium font-mono">
            {formatter ? formatter(e.value, e.dataKey) : e.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Anomaly Dots ────────────────────────────────────────────────────────────

function AnomalyDot({
  anomaly,
  onNavigate,
}: {
  anomaly: MetricAnomaly;
  onNavigate?: (executionId: string) => void;
}) {
  return (
    <button
      onClick={() => anomaly.execution_id && onNavigate?.(anomaly.execution_id)}
      className="group relative"
      title={`${ANOMALY_LABEL[anomaly.metric] ?? anomaly.metric}: ${anomaly.deviation_pct.toFixed(0)}% above baseline${anomaly.execution_id ? ' — click to inspect' : ''}`}
    >
      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20 group-hover:bg-red-500/25 transition-colors">
        <AlertTriangle className="w-2.5 h-2.5" />
        {ANOMALY_LABEL[anomaly.metric] ?? anomaly.metric}
      </span>
    </button>
  );
}

// ─── Summary Cards ───────────────────────────────────────────────────────────

function SummaryCards({ points }: { points: PromptPerformancePoint[] }) {
  const totals = useMemo(() => {
    const totalExecs = points.reduce((s, p) => s + p.total_executions, 0);
    const totalFailed = points.reduce((s, p) => s + p.failed_count, 0);
    const avgCost = totalExecs > 0
      ? points.reduce((s, p) => s + p.avg_cost_usd * p.total_executions, 0) / totalExecs
      : 0;
    const allDurations = points.flatMap(p => [p.p50_duration_ms]);
    const medianLatency = allDurations.length > 0
      ? allDurations.sort((a, b) => a - b)[Math.floor(allDurations.length / 2)] ?? 0
      : 0;
    const errorRate = totalExecs > 0 ? totalFailed / totalExecs : 0;
    const avgTokenRatio = totalExecs > 0
      ? points.reduce((s, p) => s + (p.avg_input_tokens > 0 ? p.avg_output_tokens / p.avg_input_tokens : 0) * p.total_executions, 0) / totalExecs
      : 0;
    return { totalExecs, avgCost, medianLatency, errorRate, avgTokenRatio };
  }, [points]);

  const cards = [
    { label: 'Total Executions', value: totals.totalExecs.toLocaleString(), sub: `${points.length} days` },
    { label: 'Avg Cost', value: fmtCost(totals.avgCost), sub: 'per execution' },
    { label: 'Median Latency', value: fmtMs(totals.medianLatency), sub: 'p50' },
    { label: 'Error Rate', value: fmtPct(totals.errorRate), sub: totals.errorRate > 0.2 ? 'high' : totals.errorRate > 0.05 ? 'moderate' : 'healthy' },
    { label: 'Token Ratio', value: `${totals.avgTokenRatio.toFixed(2)}x`, sub: 'out/in' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-mono">{c.label}</div>
          <div className="text-lg font-semibold text-foreground/90 font-mono mt-0.5">{c.value}</div>
          <div className="text-[11px] text-muted-foreground/50">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

interface PromptPerformanceDashboardProps {
  personaId: string;
  onNavigateExecution?: (executionId: string) => void;
}

export function PromptPerformanceDashboard({
  personaId,
  onNavigateExecution,
}: PromptPerformanceDashboardProps) {
  const [data, setData] = useState<PromptPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPromptPerformance(personaId, days);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, [personaId, days]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Find the production version for baseline reference line
  const productionVersion = useMemo(
    () => data?.version_markers.find((v) => v.tag === 'production') ?? null,
    [data],
  );



  // Version comparison: split data into before/after segments for each version
  const { comparedData, compALabel, compBLabel } = useMemo(() => {
    if (!compareMode || compareA == null || compareB == null || !data) {
      return { comparedData: null, compALabel: '', compBLabel: '' };
    }
    const markers = data.version_markers;
    const mA = markers.find(m => m.version_number === compareA);
    const mB = markers.find(m => m.version_number === compareB);
    if (!mA || !mB) return { comparedData: null, compALabel: '', compBLabel: '' };

    const dateA = mA.created_at.slice(0, 10);
    const dateB = mB.created_at.slice(0, 10);
    const [earlyDate, lateDate] = dateA < dateB ? [dateA, dateB] : [dateB, dateA];

    // Points in version A's era vs version B's era
    const pointsA = data.daily_points.filter(p => p.date >= earlyDate && p.date < lateDate);
    const pointsB = data.daily_points.filter(p => p.date >= lateDate);

    return {
      comparedData: data.daily_points.map(p => ({
        ...p,
        costA: pointsA.find(pa => pa.date === p.date)?.avg_cost_usd ?? null,
        costB: pointsB.find(pb => pb.date === p.date)?.avg_cost_usd ?? null,
        latencyA: pointsA.find(pa => pa.date === p.date)?.p50_duration_ms ?? null,
        latencyB: pointsB.find(pb => pb.date === p.date)?.p50_duration_ms ?? null,
        errorA: pointsA.find(pa => pa.date === p.date)?.error_rate ?? null,
        errorB: pointsB.find(pb => pb.date === p.date)?.error_rate ?? null,
      })),
      compALabel: `v${compareA}`,
      compBLabel: `v${compareB}`,
    };
  }, [compareMode, compareA, compareB, data]);

  // Compute production baseline cost (average cost during production version)
  const productionBaseline = useMemo(() => {
    if (!productionVersion || !data?.daily_points.length) return null;
    const prodDate = productionVersion.created_at.slice(0, 10);
    const prodPoints = data.daily_points.filter(p => p.date >= prodDate);
    if (prodPoints.length === 0) return null;
    return prodPoints.reduce((s, p) => s + p.avg_cost_usd, 0) / prodPoints.length;
  }, [productionVersion, data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-muted-foreground/60 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-2">
        <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
        <p className="text-sm text-red-300">{error}</p>
        <button onClick={fetchData} className="text-xs text-primary/70 hover:text-primary">Retry</button>
      </div>
    );
  }

  if (!data || data.daily_points.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <BarChart3 className="w-8 h-8 text-muted-foreground/20 mx-auto" />
        <p className="text-sm text-muted-foreground/60">No execution data yet</p>
        <p className="text-xs text-muted-foreground/40">Run some executions to see performance trends</p>
      </div>
    );
  }

  const versionNumbers = data.version_markers.map(v => v.version_number);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-medium text-foreground/80">Performance</h3>
          {data.anomalies.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
              {data.anomalies.length} anomal{data.anomalies.length === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-secondary/30 rounded-lg p-0.5">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => setDays(p)}
                className={`px-2 py-1 text-[11px] font-mono rounded-md transition-colors ${
                  days === p
                    ? 'bg-primary/15 text-foreground/80 border border-primary/20'
                    : 'text-muted-foreground/50 hover:text-muted-foreground/70'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
          {/* Compare toggle */}
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg transition-colors ${
              compareMode
                ? 'bg-primary/15 text-primary/80 border border-primary/20'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'
            }`}
          >
            <Layers className="w-3 h-3" />
            Compare
          </button>
          <button onClick={fetchData} className="p-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Version comparison selectors */}
      {compareMode && (
        <div className="flex items-center gap-3 px-3 py-2 bg-secondary/20 border border-primary/10 rounded-xl">
          <span className="text-xs text-muted-foreground/60">Compare versions:</span>
          <select
            value={compareA ?? ''}
            onChange={(e) => setCompareA(e.target.value ? Number(e.target.value) : null)}
            className="bg-background/50 border border-indigo-500/20 text-sm rounded-lg px-2 py-1 text-foreground/80"
          >
            <option value="">Version A</option>
            {versionNumbers.map(n => <option key={n} value={n}>v{n}</option>)}
          </select>
          <span className="text-xs text-muted-foreground/40">vs</span>
          <select
            value={compareB ?? ''}
            onChange={(e) => setCompareB(e.target.value ? Number(e.target.value) : null)}
            className="bg-background/50 border border-pink-500/20 text-sm rounded-lg px-2 py-1 text-foreground/80"
          >
            <option value="">Version B</option>
            {versionNumbers.map(n => <option key={n} value={n}>v{n}</option>)}
          </select>
        </div>
      )}

      {/* Summary cards */}
      <SummaryCards points={data.daily_points} />

      {/* Anomaly annotations */}
      {data.anomalies.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {data.anomalies.map((a, i) => (
            <AnomalyDot key={i} anomaly={a} onNavigate={onNavigateExecution} />
          ))}
        </div>
      )}

      {/* Charts grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* 1) Cost per Execution */}
        <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Cost per Execution</h4>
          <ResponsiveContainer width="100%" height={200}>
            {compareMode && comparedData ? (
              <LineChart data={comparedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtCost(v)} />
                <Tooltip content={<DashTooltip formatter={(v) => fmtCost(v)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="costA" name={compALabel} stroke={COMPARE_A_COLOR} strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="costB" name={compBLabel} stroke={COMPARE_B_COLOR} strokeWidth={2} dot={false} connectNulls />
                {productionBaseline != null && (
                  <ReferenceLine y={productionBaseline} stroke="#10b981" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: 'prod baseline', position: 'insideTopRight', fill: '#10b981', fontSize: 10 }} />
                )}
                {/* Version markers */}
                {data.version_markers.map((v) => (
                  <ReferenceLine
                    key={v.version_id}
                    x={v.created_at.slice(0, 10)}
                    stroke={VERSION_COLORS[v.tag] ?? '#71717a'}
                    strokeDasharray="4 2"
                    strokeWidth={1}
                    label={{ value: `v${v.version_number}`, position: 'top', fill: VERSION_COLORS[v.tag] ?? '#71717a', fontSize: 9 }}
                  />
                ))}
              </LineChart>
            ) : (
              <AreaChart data={data.daily_points}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtCost(v)} />
                <Tooltip content={<DashTooltip formatter={(v) => fmtCost(v)} />} />
                <Area type="monotone" dataKey="avg_cost_usd" name="Avg Cost" stroke="#6366f1" fill="url(#costGrad)" strokeWidth={2} />
                {productionBaseline != null && (
                  <ReferenceLine y={productionBaseline} stroke="#10b981" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: 'prod baseline', position: 'insideTopRight', fill: '#10b981', fontSize: 10 }} />
                )}
                {data.version_markers.map((v) => (
                  <ReferenceLine
                    key={v.version_id}
                    x={v.created_at.slice(0, 10)}
                    stroke={VERSION_COLORS[v.tag] ?? '#71717a'}
                    strokeDasharray="4 2"
                    strokeWidth={1}
                    label={{ value: `v${v.version_number}`, position: 'top', fill: VERSION_COLORS[v.tag] ?? '#71717a', fontSize: 9 }}
                  />
                ))}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* 2) Latency Distribution (p50/p95/p99) */}
        <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Latency Distribution</h4>
          <ResponsiveContainer width="100%" height={200}>
            {compareMode && comparedData ? (
              <LineChart data={comparedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtMs} />
                <Tooltip content={<DashTooltip formatter={fmtMs} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="latencyA" name={compALabel} stroke={COMPARE_A_COLOR} strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="latencyB" name={compBLabel} stroke={COMPARE_B_COLOR} strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            ) : (
              <LineChart data={data.daily_points}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtMs} />
                <Tooltip content={<DashTooltip formatter={fmtMs} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="p50_duration_ms" name="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p95_duration_ms" name="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="p99_duration_ms" name="p99" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* 3) Error Rate Trend */}
        <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Error Rate Trend</h4>
          <ResponsiveContainer width="100%" height={200}>
            {compareMode && comparedData ? (
              <LineChart data={comparedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtPct(v)} domain={[0, 'auto']} />
                <Tooltip content={<DashTooltip formatter={(v) => fmtPct(v)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="errorA" name={compALabel} stroke={COMPARE_A_COLOR} strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="errorB" name={compBLabel} stroke={COMPARE_B_COLOR} strokeWidth={2} dot={false} connectNulls />
                {data.version_markers.map((v) => (
                  <ReferenceLine key={v.version_id} x={v.created_at.slice(0, 10)} stroke={VERSION_COLORS[v.tag] ?? '#71717a'} strokeDasharray="4 2" strokeWidth={1} />
                ))}
              </LineChart>
            ) : (
              <AreaChart data={data.daily_points}>
                <defs>
                  <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
                <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtPct(v)} domain={[0, 'auto']} />
                <Tooltip content={<DashTooltip formatter={(v) => fmtPct(v)} />} />
                <Area type="monotone" dataKey="error_rate" name="Error Rate" stroke="#ef4444" fill="url(#errorGrad)" strokeWidth={2} />
                {data.version_markers.map((v) => (
                  <ReferenceLine
                    key={v.version_id}
                    x={v.created_at.slice(0, 10)}
                    stroke={VERSION_COLORS[v.tag] ?? '#71717a'}
                    strokeDasharray="4 2"
                    strokeWidth={1}
                    label={{ value: `v${v.version_number}`, position: 'top', fill: VERSION_COLORS[v.tag] ?? '#71717a', fontSize: 9 }}
                  />
                ))}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* 4) Token Efficiency (input vs output) */}
        <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Token Efficiency</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.daily_points}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} />
              <Tooltip content={<DashTooltip formatter={(v) => Math.round(v).toLocaleString()} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="avg_input_tokens" name="Input" fill="#6366f1" radius={[2, 2, 0, 0]} />
              <Bar dataKey="avg_output_tokens" name="Output" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Version timeline */}
      {data.version_markers.length > 0 && (
        <div className="bg-secondary/20 border border-primary/10 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <GitBranch className="w-3.5 h-3.5 text-primary/60" />
            <h4 className="text-xs font-medium text-foreground/70 uppercase tracking-wider">Version Timeline</h4>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.version_markers.map((v) => (
              <div
                key={v.version_id}
                className="flex-shrink-0 flex items-center gap-2 px-2.5 py-1.5 bg-background/40 border border-border/20 rounded-lg"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: VERSION_COLORS[v.tag] ?? '#71717a' }}
                />
                <span className="text-xs font-mono text-foreground/80">v{v.version_number}</span>
                <span className="text-[10px] text-muted-foreground/50">{v.tag}</span>
                <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
                  <Calendar className="w-2.5 h-2.5" />
                  {fmtDate(v.created_at.slice(0, 10))}
                </span>
                {v.change_summary && (
                  <span className="text-[10px] text-muted-foreground/40 max-w-[120px] truncate" title={v.change_summary}>
                    {v.change_summary}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
