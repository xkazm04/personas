import { memo, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { TrendingUp } from 'lucide-react';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { AreaChart, Area, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { CHART_GRAD, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { CARD_CONTAINER } from '@/features/overview/utils/dashboardGrid';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import { useOverviewFilterValues } from '../OverviewFilterContext';

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

export const TrafficErrorsChart = memo(function TrafficErrorsChart({ chartData, totalTraffic, totalErrors }: TrafficErrorsChartProps) {
  const { t } = useTranslation();
  const sf = useScaledFontSize();
  const { effectiveDays } = useOverviewFilterValues();
  const rangeLabel = effectiveDays === 1 ? 'Yesterday' : `${effectiveDays} Days Ago`;
  const formatCounter = useCallback((v: number) => Math.round(v).toLocaleString(), []);

  return (
    <div className={`${CARD_CONTAINER} p-4 space-y-4 relative overflow-hidden [&_svg]:outline-none [&_.recharts-wrapper]:outline-none`} aria-label="Traffic and errors chart">
      <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 blur-3xl rounded-full pointer-events-none" />
      <div className="flex items-center justify-between relative z-10">
        <h3 className="typo-label text-foreground flex items-center gap-2">
          <div className="p-1.5 rounded-card bg-cyan-500/10 text-cyan-400">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          {t.overview.widgets.traffic_errors_chart}
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <AnimatedCounter value={totalTraffic} className="typo-body text-foreground" formatFn={formatCounter} />
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <AnimatedCounter value={totalErrors} className="typo-body text-foreground" formatFn={formatCounter} />
          </div>
        </div>
      </div>

      <div className="h-32 w-full relative z-10">
        {chartData.length > 0 ? (
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
                <XAxis dataKey="date" tick={{ fill: getAxisTickFill(), fontSize: sf(9) }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: getAxisTickFill(), fontSize: sf(9) }} width={24} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="traffic" name="Traffic" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill={`url(#${CHART_GRAD.traffic})`} />
                <Area type="monotone" dataKey="errors" name="Errors" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill={`url(#${CHART_GRAD.error})`} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        ) : (
          <EmptyState variant="chart" className="py-6" />
        )}
      </div>

      <div className="pt-3 border-t border-primary/5 relative z-10">
        <div className="flex justify-between typo-label text-foreground">
          <span>{rangeLabel}</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
});
