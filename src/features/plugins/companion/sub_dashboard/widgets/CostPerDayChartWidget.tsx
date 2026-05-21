import { memo, useEffect, useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import type { WidgetProps } from '../widgetRegistry';

const Y_AXIS_FORMATTER = (v: number) => `$${v.toFixed(2)}`;
const TOOLTIP_FORMATTER = (v: unknown): [string, string] => [
  typeof v === 'number' ? `$${v.toFixed(4)}` : String(v),
  'Cost',
];

/**
 * Cost-per-day area chart.
 *
 * Athena-facing config:
 *   { "days": 7 | 30 | 90 }   default 30
 */
export const CostPerDayChartWidget = memo(function CostPerDayChartWidget({ config, title }: WidgetProps) {
  const days = (config?.days as number) ?? 30;
  const { data, fetchExecutionDashboard } = useOverviewStore(
    useShallow((s) => ({
      data: s.executionDashboard,
      fetchExecutionDashboard: s.fetchExecutionDashboard,
    })),
  );
  useEffect(() => {
    fetchExecutionDashboard(days);
  }, [days, fetchExecutionDashboard]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return (data.daily_points || []).map((p) => ({
      date: p.date.slice(5),
      cost: p.total_cost || 0,
    }));
  }, [data]);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground uppercase tracking-wide mb-2">
        {title ?? `Cost per day (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0">
        <LazyChart render={(R) => (
          <R.ResponsiveContainer width="100%" height="100%">
            <R.AreaChart data={chartData}>
              <defs>
                <linearGradient id="cost-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <R.CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <R.XAxis dataKey="date" stroke="currentColor" fontSize={11} />
              <R.YAxis stroke="currentColor" fontSize={11} tickFormatter={Y_AXIS_FORMATTER} />
              <R.Tooltip formatter={TOOLTIP_FORMATTER} />
              <R.Area type="monotone" dataKey="cost" stroke="#06b6d4" fill="url(#cost-grad)" strokeWidth={2} />
            </R.AreaChart>
          </R.ResponsiveContainer>
        )} />
      </div>
    </div>
  );
});
