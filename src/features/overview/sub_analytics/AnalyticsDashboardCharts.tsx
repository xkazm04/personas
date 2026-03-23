import { useId } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  ComposedChart,
} from 'recharts';
import { MetricChart } from '@/features/overview/sub_usage/charts/MetricChart';
import { ChartTooltip } from '@/features/overview/sub_usage/charts/ChartTooltip';
import { CHART_COLORS, CHART_COLORS_PURPLE, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import type { PieDataPoint } from '@/features/overview/sub_observability/components/MetricsCharts';
import type { MetricsChartPoint } from '@/lib/bindings/MetricsChartPoint';

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BarDataItem {
  name: string;
  invocations: number;
  executions: number;
  personas: number;
}

interface LatencyDataItem {
  date: string;
  p50: number;
  p95: number;
  p99: number;
}

export interface AnalyticsDashboardChartsProps {
  chartData: (MetricsChartPoint & Record<string, unknown>)[];
  compareEnabled: boolean;
  areaData: Record<string, unknown>[];
  allToolNames: string[];
  pieData: PieDataPoint[];
  latencyData: LatencyDataItem[];
  barData: BarDataItem[];
  handleFailureBarClick: (data: MetricsChartPoint) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalyticsDashboardCharts({
  chartData,
  compareEnabled,
  areaData,
  allToolNames,
  pieData,
  latencyData,
  barData,
  handleFailureBarClick,
}: AnalyticsDashboardChartsProps) {
  const costGradId = useId();

  return (
    <>
      {/* Charts -- 2 column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost Over Time */}
        <MetricChart title="Cost Over Time" height={180}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
            <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => `$${v}`} />
            <Tooltip content={<ChartTooltip />} />
            {compareEnabled && (
              <Area type="monotone" dataKey="prev_cost" name="Prev Cost" stroke="#6366f1" fill="none" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />
            )}
            <Area type="monotone" dataKey="cost" stroke="#6366f1" fill={`url(#${costGradId})`} strokeWidth={2} />
            <defs>
              <linearGradient id={costGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
          </AreaChart>
        </MetricChart>

        {/* Execution Health */}
        <MetricChart title="Execution Health" height={180}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
            <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} />
            <Tooltip content={<ChartTooltip />} cursor={false} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="success" name="Successful" fill="#22c55e" radius={[2, 2, 0, 0]} />
            <Bar
              dataKey="failed"
              name="Failed"
              fill="#ef4444"
              radius={[2, 2, 0, 0]}
              cursor="pointer"
              onClick={(data: { payload?: MetricsChartPoint }) => {
                if (data.payload) handleFailureBarClick(data.payload);
              }}
            />
            {compareEnabled && (
              <Line type="monotone" dataKey="prev_success" name="Prev Successful" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />
            )}
            {compareEnabled && (
              <Line type="monotone" dataKey="prev_failed" name="Prev Failed" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />
            )}
          </ComposedChart>
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

        {/* Latency Distribution (p50 / p95 / p99) */}
        {latencyData.length > 0 && (
          <MetricChart title="Latency (p50 / p95 / p99)" height={180}>
            <LineChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => new Date(v + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="p50" name="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95" name="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line type="monotone" dataKey="p99" name="p99" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            </LineChart>
          </MetricChart>
        )}
      </div>

      {/* Tool Invocations -- full width horizontal bar */}
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
    </>
  );
}
