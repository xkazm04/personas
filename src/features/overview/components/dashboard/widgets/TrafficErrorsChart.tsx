import { useId } from 'react';
import { TrendingUp } from 'lucide-react';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { AreaChart, Area, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/libs/chartConstants';
import { CARD_CONTAINER } from '@/features/overview/utils/dashboardGrid';

interface ChartDataPoint {
  date: string;
  traffic: number;
  errors: number;
}

interface TrafficErrorsChartProps {
  chartData: ChartDataPoint[];
  totalTraffic: number;
  totalErrors: number;
}

export function TrafficErrorsChart({ chartData, totalTraffic, totalErrors }: TrafficErrorsChartProps) {
  const id = useId();
  const trafficGradId = `${id}-traffic`;
  const errorGradId = `${id}-error`;

  return (
    <div className={`${CARD_CONTAINER} p-4 space-y-4 relative overflow-hidden`} aria-label="Traffic and errors chart">
      <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 blur-3xl rounded-full pointer-events-none" />
      <div className="flex items-center justify-between relative z-10">
        <h3 className="typo-label text-foreground/80 flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          Traffic & Errors
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <AnimatedCounter value={totalTraffic} className="typo-body text-muted-foreground/60" formatFn={(v) => Math.round(v).toLocaleString()} />
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <AnimatedCounter value={totalErrors} className="typo-body text-muted-foreground/60" formatFn={(v) => Math.round(v).toLocaleString()} />
          </div>
        </div>
      </div>

      <div className="h-32 w-full relative z-10">
        {chartData.length > 0 ? (
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={trafficGradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id={errorGradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 9 }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 9 }} width={24} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="traffic" name="Traffic" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill={`url(#${trafficGradId})`} />
                <Area type="monotone" dataKey="errors" name="Errors" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill={`url(#${errorGradId})`} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <p className="typo-body text-muted-foreground/50">No execution data yet</p>
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-primary/5 relative z-10">
        <div className="flex justify-between typo-label text-muted-foreground/60">
          <span>14 Days Ago</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
