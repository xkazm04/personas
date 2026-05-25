import { memo, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { TrendingUp } from 'lucide-react';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { CHART_GRAD, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { useOverviewFilterValues } from '../OverviewFilterContext';
import { debtText } from '@/i18n/DebtText';
import { DashboardChartCard } from './DashboardChartCard';


interface ChartDataPoint {
  date: string;
  traffic: number;
  errors: number;
}

interface TrafficErrorsChartProps {
  chartData: ChartDataPoint[];
  totalTraffic: number;
  totalErrors: number;
  /** Optional header controls (e.g. a range switch) rendered before the totals. */
  rangeControl?: React.ReactNode;
}

export const TrafficErrorsChart = memo(function TrafficErrorsChart({ chartData, totalTraffic, totalErrors, rangeControl }: TrafficErrorsChartProps) {
  const { t } = useTranslation();
  const sf = useScaledFontSize();
  const { effectiveDays } = useOverviewFilterValues();
  const rangeLabel = effectiveDays === 1 ? 'Yesterday' : `${effectiveDays} Days Ago`;
  const formatCounter = useCallback((v: number) => Math.round(v).toLocaleString(), []);

  return (
    <DashboardChartCard
      title={t.overview.widgets.traffic_errors_chart}
      icon={TrendingUp}
      ariaLabel={debtText('auto_traffic_and_errors_chart_9bc7679b')}
      isEmpty={chartData.length === 0}
      emptyVariant="chart"
      actions={
        <>
          {rangeControl}
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
        </>
      }
      footer={
        <div className="flex justify-between typo-label text-foreground">
          <span>{rangeLabel}</span>
          <span>Today</span>
        </div>
      }
    >
      {(R) => (
        <R.AreaChart data={chartData}>
          <R.CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
          <R.XAxis dataKey="date" tick={{ fill: getAxisTickFill(), fontSize: sf(9) }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
          <R.YAxis tick={{ fill: getAxisTickFill(), fontSize: sf(9) }} width={24} axisLine={false} tickLine={false} allowDecimals={false} />
          <R.Tooltip content={<ChartTooltip />} />
          <R.Area type="monotone" dataKey="traffic" name="Traffic" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill={`url(#${CHART_GRAD.traffic})`} />
          <R.Area type="monotone" dataKey="errors" name="Errors" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill={`url(#${CHART_GRAD.error})`} />
        </R.AreaChart>
      )}
    </DashboardChartCard>
  );
});
