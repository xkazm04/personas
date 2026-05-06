import { useEffect } from 'react';
import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from 'recharts';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';

/**
 * Success-rate gauge — a single radial bar from 0-100%, with the
 * percentage centered.
 *
 * Different from `kpi_tile` with metric=success_rate because the
 * radial shape gives an instant "where on the scale am I" read
 * without numeric reasoning. Color-codes red < 80% < amber < 95% <
 * green so the user can spot trouble in their peripheral vision.
 *
 * Athena-facing config:
 *   { "days": 7 | 30 | 90 }   default 7
 */
export function SuccessRateGaugeWidget({ config, title }: WidgetProps) {
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

  const ratio = data?.overall_success_rate ?? 0;
  const pct = Math.round(ratio * 100);
  const color = pct >= 95 ? '#22c55e' : pct >= 80 ? '#f59e0b' : '#ef4444';
  const chartData = [{ name: 'success', value: pct, fill: color }];

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-2">
        {title ?? `Success rate (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="65%"
            outerRadius="95%"
            data={chartData}
            startAngle={210}
            endAngle={-30}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: 'rgba(255,255,255,0.05)' }} dataKey="value" cornerRadius={6} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="typo-h2 font-semibold tabular-nums" style={{ color }}>
            {pct}%
          </div>
          <div className="typo-caption text-foreground/50">
            {data?.daily_points?.reduce((s, p) => s + (p.total_executions || 0), 0) ?? 0} runs
          </div>
        </div>
      </div>
    </div>
  );
}
