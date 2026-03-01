import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  DollarSign, Zap, CheckCircle, Clock,
  TrendingUp, AlertTriangle, ArrowUpRight,
  Loader2, X,
} from 'lucide-react';
import { getExecutionDashboard } from '@/api/observability';
import type { ExecutionDashboardData } from '@/lib/bindings/ExecutionDashboardData';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimeWindow = 1 | 7 | 30;

const TIME_WINDOWS: Array<{ value: TimeWindow; label: string }> = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
];

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const fmtCost = (v: number) => v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtMs = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-500/15 border-blue-500/25',
    emerald: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25',
    violet: 'text-violet-400 bg-violet-500/15 border-violet-500/25',
    amber: 'text-amber-400 bg-amber-500/15 border-amber-500/25',
  };
  const c = colorMap[color] ?? colorMap.blue!;
  const parts = c.split(' ');
  const textColor = parts[0];
  const bg = parts[1];
  const border = parts[2];

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${border} ${bg}`}>
      <Icon className={`w-4 h-4 ${textColor}`} />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground/70 truncate">{label}</p>
        <p className={`text-sm font-semibold ${textColor}`}>{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anomaly Badge
// ---------------------------------------------------------------------------

function AnomalyBadge({
  anomaly,
  onClickExecution,
}: {
  anomaly: DashboardCostAnomaly;
  onClickExecution?: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/25 bg-amber-500/10">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-amber-300">
          {fmtDate(anomaly.date)} — Cost spike {fmtCost(anomaly.cost)}
          <span className="text-amber-400/70 ml-1">
            ({anomaly.deviation_sigma.toFixed(1)}σ above avg {fmtCost(anomaly.moving_avg)})
          </span>
        </p>
        {anomaly.execution_ids.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground/60">Top executions:</span>
            {anomaly.execution_ids.map((id) => (
              <button
                key={id}
                onClick={() => onClickExecution?.(id)}
                className="text-[10px] font-mono text-blue-400 hover:text-blue-300 underline decoration-blue-400/30"
              >
                {id.slice(0, 8)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 border border-primary/20 rounded-lg px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-xs text-muted-foreground/80 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground/70">{entry.name}:</span>
          <span className="font-mono text-foreground/90">{typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

interface ExecutionMetricsDashboardProps {
  onClose?: () => void;
}

export function ExecutionMetricsDashboard({ onClose }: ExecutionMetricsDashboardProps) {
  const [days, setDays] = useState<TimeWindow>(7);
  const [data, setData] = useState<ExecutionDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getExecutionDashboard(days);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // Build chart-ready arrays + per-persona cost breakdown in a single pass
  const { chartData, personaCostData, personaNames } = useMemo(() => {
    if (!data) return { chartData: [], personaCostData: [], personaNames: [] as string[] };

    // First pass: compute total cost per persona across all days
    const totalCostByPersona = new Map<string, number>();
    for (const pt of data.daily_points) {
      for (const pc of pt.persona_costs) {
        totalCostByPersona.set(pc.persona_name, (totalCostByPersona.get(pc.persona_name) || 0) + pc.cost);
      }
    }

    // Keep only top 8 by total cost
    const sorted = Array.from(totalCostByPersona.entries()).sort((a, b) => b[1] - a[1]);
    const top8 = new Set(sorted.slice(0, 8).map(([name]) => name));
    const hasOther = sorted.length > 8;

    const chartRows: Array<Record<string, string | number>> = [];
    const personaCostRows: Array<Record<string, string | number>> = [];

    for (const pt of data.daily_points) {
      // Chart data row
      chartRows.push({
        date: fmtDate(pt.date),
        rawDate: pt.date,
        cost: pt.total_cost,
        executions: pt.total_executions,
        completed: pt.completed,
        failed: pt.failed,
        successRate: pt.success_rate * 100,
        p50: pt.p50_duration_ms,
        p95: pt.p95_duration_ms,
        p99: pt.p99_duration_ms,
      });

      // Persona cost row with top-8 capping
      const row: Record<string, string | number> = { date: fmtDate(pt.date) };
      let otherCost = 0;
      for (const pc of pt.persona_costs) {
        if (top8.has(pc.persona_name)) {
          row[pc.persona_name] = pc.cost;
        } else {
          otherCost += pc.cost;
        }
      }
      if (otherCost > 0) {
        row['Other'] = otherCost;
      }
      personaCostRows.push(row);
    }

    const names = sorted.slice(0, 8).map(([name]) => name);
    if (hasOther) names.push('Other');

    return { chartData: chartRows, personaCostData: personaCostRows, personaNames: names };
  }, [data]);

  // Anomaly dates for reference lines
  const anomalyDates = useMemo(
    () => new Set(data?.cost_anomalies.map((a) => fmtDate(a.date)) ?? []),
    [data],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 text-primary/60 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={load} className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!data || data.daily_points.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <TrendingUp className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground/70">No execution data for the selected period</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      {/* Header row: time window picker + close */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-foreground/90">Execution Metrics</h3>
          <div className="flex items-center gap-1 p-0.5 bg-secondary/50 rounded-lg border border-primary/15">
            {TIME_WINDOWS.map((tw) => (
              <button
                key={tw.value}
                onClick={() => setDays(tw.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  days === tw.value
                    ? 'bg-background text-foreground shadow-sm border border-primary/20'
                    : 'text-muted-foreground/70 hover:text-muted-foreground'
                }`}
              >
                {tw.label}
              </button>
            ))}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Zap} label="Total Executions" value={data.total_executions.toLocaleString()} color="blue" />
        <SummaryCard icon={DollarSign} label="Total Cost" value={fmtCost(data.total_cost)} color="violet" />
        <SummaryCard icon={CheckCircle} label="Success Rate" value={fmtPct(data.overall_success_rate)} color="emerald" />
        <SummaryCard icon={Clock} label="Avg Latency" value={fmtMs(data.avg_latency_ms)} color="amber" />
      </div>

      {/* Cost Anomaly Alerts */}
      {data.cost_anomalies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-amber-400/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Cost Anomalies Detected
          </h4>
          {data.cost_anomalies.map((a, i) => (
            <AnomalyBadge key={i} anomaly={a} />
          ))}
        </div>
      )}

      {/* Cost per Day (with per-persona breakdown) */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground/70">Cost per Day</h4>
        <div className="h-48 bg-secondary/20 rounded-xl border border-primary/10 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={personaCostData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
              {personaNames.map((name, i) => (
                <Area
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stackId="1"
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.3}
                />
              ))}
              {/* Anomaly markers as reference lines */}
              {chartData.filter((pt) => anomalyDates.has(String(pt.date))).map((pt) => (
                <ReferenceLine key={pt.date} x={pt.date} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.6} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Execution Count by Status */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground/70">Executions by Status</h4>
        <div className="h-40 bg-secondary/20 rounded-xl border border-primary/10 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="completed" name="Completed" stackId="status" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="failed" name="Failed" stackId="status" fill="#ef4444" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Success Rate Trend */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground/70">Success Rate Trend</h4>
        <div className="h-40 bg-secondary/20 rounded-xl border border-primary/10 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="successRate" name="Success %" stroke="#10b981" strokeWidth={2} dot={false} />
              <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.3} label={{ value: '90%', fill: AXIS_TICK_FILL, fontSize: 9 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Latency Distribution (p50/p95/p99) */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground/70">Latency Distribution (p50 / p95 / p99)</h4>
        <div className="h-40 bg-secondary/20 rounded-xl border border-primary/10 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} tickFormatter={(v: number) => fmtMs(v)} />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="p50" name="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95" name="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line type="monotone" dataKey="p99" name="p99" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top-5 Costliest Personas */}
      {data.top_personas.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground/70">Top Personas by Cost</h4>
          <div className="space-y-1.5">
            {data.top_personas.map((p, i) => {
              const maxCost = data.top_personas[0]?.total_cost || 1;
              const pct = (p.total_cost / maxCost) * 100;
              return (
                <div key={p.persona_id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-primary/10 bg-secondary/20">
                  <span className="text-xs font-mono text-muted-foreground/60 w-4 text-right">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground/80 truncate">{p.persona_name}</span>
                      <span className="text-xs font-mono text-violet-400">{fmtCost(p.total_cost)}</span>
                    </div>
                    <div className="h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/60">
                      <span>{p.total_executions} executions</span>
                      <span>~{fmtCost(p.avg_cost_per_exec)}/exec</span>
                    </div>
                  </div>
                  <ArrowUpRight className="w-3 h-3 text-muted-foreground/30" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
