import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { MetricChart } from '@/features/overview/sub_usage/components/MetricChart';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { CHART_GRAD, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { useChartSeries } from '@/features/overview/sub_analytics/libs/useChartSeries';
import { RotationOverviewPanel } from '@/features/overview/sub_analytics/components/RotationOverviewPanel';

/**
 * Lazy-loaded analytics inserts for DashboardHome.
 * Keeps recharts out of the eager bundle.
 */
const AnalyticsInserts = memo(function AnalyticsInserts({ position }: { position: 'center' | 'right' }) {
  if (position === 'center') return <CenterCharts />;
  return <RightPanels />;
});

export default AnalyticsInserts;

function CenterCharts() {
  const { t } = useTranslation();
  const { chartData } = useChartSeries();
  const sf = useScaledFontSize();

  return (
    <>
      {/* Execution Health */}
      <MetricChart
        title={t.overview.widgets_extra.execution_health_chart}
        height={160}
        chart={(R) => (
          <R.ComposedChart data={chartData}>
            <R.CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
            <R.XAxis dataKey="dateLabel" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
            <R.YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
            <R.Tooltip content={<ChartTooltip />} cursor={false} />
            <R.Legend wrapperStyle={{ fontSize: sf(11) }} />
            <R.Bar dataKey="success" name={t.overview.widgets_extra.successful} fill="#22c55e" radius={[2, 2, 0, 0]} />
            <R.Bar dataKey="failed" name={t.overview.widgets_extra.failed} fill="#ef4444" radius={[2, 2, 0, 0]} />
          </R.ComposedChart>
        )}
      />

      {/* Cost Over Time */}
      <MetricChart
        title={t.overview.widgets_extra.cost_over_time_chart}
        height={160}
        chart={(R) => (
          <R.AreaChart data={chartData}>
            <R.CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
            <R.XAxis dataKey="dateLabel" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
            <R.YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} tickFormatter={(v) => `$${v}`} />
            <R.Tooltip content={<ChartTooltip />} />
            <R.Area type="monotone" dataKey="cost" stroke="#6366f1" fill={`url(#${CHART_GRAD.cost})`} strokeWidth={2} />
          </R.AreaChart>
        )}
      />
    </>
  );
}

function RightPanels() {
  return (
    <>
      <RotationOverviewPanel />
    </>
  );
}
