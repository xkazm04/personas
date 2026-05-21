import { memo, useEffect, useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import type { WidgetProps } from '../widgetRegistry';
import { DebtText } from '@/i18n/DebtText';


const PALETTE = [
  '#06b6d4', '#22c55e', '#f59e0b', '#a855f7', '#ec4899',
  '#10b981', '#3b82f6', '#ef4444',
];

const LEGEND_STYLE = { fontSize: 11 };

/**
 * Persona cost donut — proportional split of cost across personas.
 *
 * Different shape from `top_personas_list`: list = ranked, donut =
 * proportion. Donut answers "is this concentrated in one agent or
 * spread evenly?" at a glance — a list does not.
 *
 * Athena-facing config:
 *   { "days": 30, "limit": 6 }   limit caps slices; rest go to "Other"
 */
export const PersonaCostDonutWidget = memo(function PersonaCostDonutWidget({ config, title }: WidgetProps) {
  const days = (config?.days as number) ?? 30;
  const limit = (config?.limit as number) ?? 6;
  const { data, fetchExecutionDashboard } = useOverviewStore(
    useShallow((s) => ({
      data: s.executionDashboard,
      fetchExecutionDashboard: s.fetchExecutionDashboard,
    })),
  );
  useEffect(() => {
    fetchExecutionDashboard(days);
  }, [days, fetchExecutionDashboard]);

  const slices = useMemo(() => {
    if (!data) return [] as { name: string; value: number }[];
    const totals = new Map<string, number>();
    for (const pt of data.daily_points || []) {
      for (const pc of pt.persona_costs || []) {
        totals.set(pc.persona_name, (totals.get(pc.persona_name) || 0) + pc.cost);
      }
    }
    const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, limit);
    const rest = sorted.slice(limit).reduce((s, [, v]) => s + v, 0);
    const out = top.map(([name, value]) => ({ name, value }));
    if (rest > 0) out.push({ name: 'Other', value: rest });
    return out;
  }, [data, limit]);

  const total = slices.reduce((s, sl) => s + sl.value, 0);
  const tooltipFormatter = useMemo(
    () => (v: unknown, name: unknown): [string, string] => [
      typeof v === 'number'
        ? `$${v.toFixed(2)} (${total > 0 ? Math.round((v / total) * 100) : 0}%)`
        : String(v),
      String(name ?? ''),
    ],
    [total],
  );

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground uppercase tracking-wide mb-2">
        {title ?? `Cost share by persona (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0">
        {slices.length === 0 ? (
          <div className="h-full flex items-center justify-center typo-caption text-foreground">
            <DebtText k="auto_no_data_d802d232" />
          </div>
        ) : (
          <LazyChart render={(R) => (
            <R.ResponsiveContainer width="100%" height="100%">
              <R.PieChart>
                <R.Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {slices.map((_, i) => (
                    <R.Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </R.Pie>
                <R.Tooltip formatter={tooltipFormatter} />
                <R.Legend wrapperStyle={LEGEND_STYLE} />
              </R.PieChart>
            </R.ResponsiveContainer>
          )} />
        )}
      </div>
    </div>
  );
});
