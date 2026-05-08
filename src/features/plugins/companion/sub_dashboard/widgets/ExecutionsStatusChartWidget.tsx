import { memo, useEffect, useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import type { WidgetProps } from '../widgetRegistry';

const LEGEND_STYLE = { fontSize: 11 };
const Y_AXIS_DOMAIN: [number, number] = [0, 100];

/**
 * Stacked bar (completed/failed) + success-rate line.
 *
 * Athena-facing config:
 *   { "days": 7 | 30 | 90 }   default 7
 */
export const ExecutionsStatusChartWidget = memo(function ExecutionsStatusChartWidget({ config, title }: WidgetProps) {
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
      date: p.date.slice(5), // MM-DD
      completed: p.completed,
      failed: p.failed,
      successRate: (p.success_rate || 0) * 100,
    }));
  }, [data]);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-2">
        {title ?? `Executions by status (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0">
        <LazyChart render={(R) => (
          <R.ResponsiveContainer width="100%" height="100%">
            <R.ComposedChart data={chartData}>
              <R.CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <R.XAxis dataKey="date" stroke="currentColor" fontSize={11} />
              <R.YAxis yAxisId="left" stroke="currentColor" fontSize={11} />
              <R.YAxis yAxisId="right" orientation="right" stroke="currentColor" fontSize={11} domain={Y_AXIS_DOMAIN} />
              <R.Tooltip />
              <R.Legend wrapperStyle={LEGEND_STYLE} />
              <R.Bar yAxisId="left" dataKey="completed" stackId="a" fill="#10b981" name="Completed" />
              <R.Bar yAxisId="left" dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
              <R.Line yAxisId="right" type="monotone" dataKey="successRate" stroke="#06b6d4" name="Success %" dot={false} strokeWidth={2} />
            </R.ComposedChart>
          </R.ResponsiveContainer>
        )} />
      </div>
    </div>
  );
});
