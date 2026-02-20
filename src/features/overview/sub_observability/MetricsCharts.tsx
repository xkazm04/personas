import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { CHART_COLORS_PURPLE, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { ChartTooltip } from '@/features/overview/sub_usage/charts/ChartTooltip';

export interface ChartDataPoint {
  date: string;
  cost: number;
  executions: number;
  success: number;
  failed: number;
  tokens: number;
}

export interface PieDataPoint {
  name: string;
  executions: number;
  cost: number;
}

export interface MetricsChartsProps {
  chartData: ChartDataPoint[];
  pieData: PieDataPoint[];
}

export function MetricsCharts({ chartData, pieData }: MetricsChartsProps) {
  return (
    <>
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
    </>
  );
}
