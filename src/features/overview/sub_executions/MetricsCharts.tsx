import {
  AreaChart, Area, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ComposedChart,
} from 'recharts';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/charts/ChartErrorBoundary';
import { ChartTooltipContent, fmtCost, fmtMs } from './MetricsSummaryCards';

// ── Cost Per Day Chart ───────────────────────────────────────────────

interface CostPerDayChartProps {
  personaCostData: Array<Record<string, string | number>>;
  personaNames: string[];
  chartData: Array<Record<string, string | number>>;
  anomalyDates: Set<string>;
  burnRate: number | null | undefined;
}

export function CostPerDayChart({ personaCostData, personaNames, chartData, anomalyDates, burnRate }: CostPerDayChartProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground/70">Cost per Day</h4>
      <div className="h-48 bg-secondary/20 rounded-xl border border-primary/10 p-3">
        <ChartErrorBoundary>
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
              {chartData.filter((pt) => anomalyDates.has(String(pt.date))).map((pt) => (
                <ReferenceLine key={pt.date} x={pt.date} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.6} />
              ))}
              {burnRate != null && burnRate > 0 && (
                <ReferenceLine
                  y={burnRate}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  label={{ position: 'insideTopLeft', value: `7d Burn Rate: ${fmtCost(burnRate)}/d`, fill: '#f97316', fontSize: 10 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </ChartErrorBoundary>
      </div>
    </div>
  );
}

// ── Executions By Status Chart ───────────────────────────────────────

interface ExecutionsByStatusChartProps {
  data: Array<Record<string, string | number>>;
  compareEnabled: boolean;
}

export function ExecutionsByStatusChart({ data, compareEnabled }: ExecutionsByStatusChartProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground/70">Executions by Status</h4>
      <div className="h-40 bg-secondary/20 rounded-xl border border-primary/10 p-3">
        <ChartErrorBoundary>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="completed" name="Completed" stackId="status" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="failed" name="Failed" stackId="status" fill="#ef4444" radius={[2, 2, 0, 0]} />
              {compareEnabled && (
                <Line type="monotone" dataKey="prev_completed" name="Prev Completed" stroke="#10b981" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />
              )}
              {compareEnabled && (
                <Line type="monotone" dataKey="prev_failed" name="Prev Failed" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartErrorBoundary>
      </div>
    </div>
  );
}

// ── Success Rate Chart ───────────────────────────────────────────────

interface SuccessRateChartProps {
  data: Array<Record<string, string | number>>;
  compareEnabled: boolean;
}

export function SuccessRateChart({ data, compareEnabled }: SuccessRateChartProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground/70">Success Rate Trend</h4>
      <div className="h-40 bg-secondary/20 rounded-xl border border-primary/10 p-3">
        <ChartErrorBoundary>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltipContent />} />
              {compareEnabled && (
                <Line type="monotone" dataKey="prev_successRate" name="Prev Success %" stroke="#10b981" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />
              )}
              <Line type="monotone" dataKey="successRate" name="Success %" stroke="#10b981" strokeWidth={2} dot={false} />
              <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.3} label={{ value: '90%', fill: AXIS_TICK_FILL, fontSize: 9 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartErrorBoundary>
      </div>
    </div>
  );
}

// ── Latency Distribution Chart ───────────────────────────────────────

interface LatencyChartProps {
  data: Array<Record<string, string | number>>;
  compareEnabled: boolean;
}

export function LatencyChart({ data, compareEnabled }: LatencyChartProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground/70">Latency Distribution (p50 / p95 / p99)</h4>
      <div className="h-40 bg-secondary/20 rounded-xl border border-primary/10 p-3">
        <ChartErrorBoundary>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} tickFormatter={(v: number) => fmtMs(v)} />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
              {compareEnabled && (
                <Line type="monotone" dataKey="prev_p50" name="Prev p50" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />
              )}
              {compareEnabled && (
                <Line type="monotone" dataKey="prev_p95" name="Prev p95" stroke="#f59e0b" strokeWidth={1} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />
              )}
              <Line type="monotone" dataKey="p50" name="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95" name="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line type="monotone" dataKey="p99" name="p99" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            </LineChart>
          </ResponsiveContainer>
        </ChartErrorBoundary>
      </div>
    </div>
  );
}
