import { useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';

const PALETTE = [
  '#06b6d4', '#22c55e', '#f59e0b', '#a855f7', '#ec4899',
  '#10b981', '#3b82f6', '#ef4444',
];

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
export function PersonaCostDonutWidget({ config, title }: WidgetProps) {
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

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-2">
        {title ?? `Cost share by persona (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0">
        {slices.length === 0 ? (
          <div className="h-full flex items-center justify-center typo-caption text-foreground/40">
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                strokeWidth={0}
              >
                {slices.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => [
                  typeof v === 'number'
                    ? `$${v.toFixed(2)} (${total > 0 ? Math.round((v / total) * 100) : 0}%)`
                    : String(v),
                  name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
