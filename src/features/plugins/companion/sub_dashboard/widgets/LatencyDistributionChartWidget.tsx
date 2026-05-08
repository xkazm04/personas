import { memo, useEffect, useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import type { WidgetProps } from '../widgetRegistry';

const Y_AXIS_FORMATTER = (v: number) => `${(v / 1000).toFixed(1)}s`;
const TOOLTIP_FORMATTER = (v: unknown): string =>
  typeof v === 'number' ? `${(v / 1000).toFixed(2)}s` : String(v);
const LEGEND_STYLE = { fontSize: 11 };

/**
 * Latency distribution — p50/p95/p99 lines over time.
 *
 * High signal for "are agents getting slower?" — p95 climbing while
 * p50 stays flat is the classic "tail-latency drift" pattern that
 * doesn't show up in average-only charts.
 *
 * Athena-facing config:
 *   { "days": 7 | 30 | 90 }   default 7
 */
export const LatencyDistributionChartWidget = memo(function LatencyDistributionChartWidget({ config, title }: WidgetProps) {
  const days = (config?.days as number) ?? 7;
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
      p50: p.p50_duration_ms || 0,
      p95: p.p95_duration_ms || 0,
      p99: p.p99_duration_ms || 0,
    }));
  }, [data]);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-2">
        {title ?? `Latency p50 / p95 / p99 (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0">
        <LazyChart render={(R) => (
          <R.ResponsiveContainer width="100%" height="100%">
            <R.LineChart data={chartData}>
              <R.CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <R.XAxis dataKey="date" stroke="currentColor" fontSize={11} />
              <R.YAxis
                stroke="currentColor"
                fontSize={11}
                tickFormatter={Y_AXIS_FORMATTER}
              />
              <R.Tooltip formatter={TOOLTIP_FORMATTER} />
              <R.Legend wrapperStyle={LEGEND_STYLE} />
              <R.Line type="monotone" dataKey="p50" stroke="#22c55e" name="p50" dot={false} strokeWidth={1.5} />
              <R.Line type="monotone" dataKey="p95" stroke="#f59e0b" name="p95" dot={false} strokeWidth={1.5} />
              <R.Line type="monotone" dataKey="p99" stroke="#ef4444" name="p99" dot={false} strokeWidth={1.5} />
            </R.LineChart>
          </R.ResponsiveContainer>
        )} />
      </div>
    </div>
  );
});
