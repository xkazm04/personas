import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { CHART_COLORS_PURPLE, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { ChartTooltip } from '@/features/overview/sub_usage/charts/ChartTooltip';
import { MetricChart } from '@/features/overview/sub_usage/charts/MetricChart';
import type { MetricsChartPoint } from '@/lib/bindings/MetricsChartPoint';

export interface PieDataPoint {
  name: string;
  executions: number;
  cost: number;
}

export interface MetricsChartsProps {
  chartData: MetricsChartPoint[];
  pieData: PieDataPoint[];
}

export function MetricsCharts({ chartData, pieData }: MetricsChartsProps) {
  return (
    <div className="space-y-6">
      {/* Charts Row 1 */}
      <div className="grid grid-cols-2 gap-6">
        {/* Cost Over Time */}
        <MetricChart title="Cost Over Time" height={240}>
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
        </MetricChart>

        {/* Execution Distribution */}
        <MetricChart
          title="Executions by Persona"
          height={240}
          emptySlot={
            pieData.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground/80">
                No execution data
              </div>
            ) : undefined
          }
        >
          <PieChart>
            <Pie data={pieData} dataKey="executions" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${String(name ?? '')} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS_PURPLE[i % CHART_COLORS_PURPLE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </MetricChart>
      </div>

      {/* Charts Row 2 */}
      <MetricChart title="Execution Health" height={240}>
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
    </div>
  );
}
