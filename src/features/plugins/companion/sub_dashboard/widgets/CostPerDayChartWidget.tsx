import { useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';

/**
 * Cost-per-day area chart.
 *
 * Athena-facing config:
 *   { "days": 7 | 30 | 90 }   default 30
 */
export function CostPerDayChartWidget({ config, title }: WidgetProps) {
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
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-2">
        {title ?? `Cost per day (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="cost-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" stroke="currentColor" fontSize={11} />
            <YAxis stroke="currentColor" fontSize={11} tickFormatter={(v) => `$${v.toFixed(2)}`} />
            <Tooltip
              formatter={(v) => [
                typeof v === 'number' ? `$${v.toFixed(4)}` : String(v),
                'Cost',
              ]}
            />
            <Area type="monotone" dataKey="cost" stroke="#06b6d4" fill="url(#cost-grad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
