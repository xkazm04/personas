import { useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';

/**
 * Stacked bar (completed/failed) + success-rate line.
 *
 * Athena-facing config:
 *   { "days": 7 | 30 | 90 }   default 7
 */
export function ExecutionsStatusChartWidget({ config, title }: WidgetProps) {
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
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" stroke="currentColor" fontSize={11} />
            <YAxis yAxisId="left" stroke="currentColor" fontSize={11} />
            <YAxis yAxisId="right" orientation="right" stroke="currentColor" fontSize={11} domain={[0, 100]} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="completed" stackId="a" fill="#10b981" name="Completed" />
            <Bar yAxisId="left" dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
            <Line yAxisId="right" type="monotone" dataKey="successRate" stroke="#06b6d4" name="Success %" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
