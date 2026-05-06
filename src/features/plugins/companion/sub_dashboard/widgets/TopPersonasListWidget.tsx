import { useEffect, useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';

/**
 * Top personas by cost — a ranked list with cost bars.
 *
 * Athena-facing config:
 *   { "days": 30, "limit": 5 }
 */
export function TopPersonasListWidget({ config, title }: WidgetProps) {
  const days = (config?.days as number) ?? 30;
  const limit = (config?.limit as number) ?? 5;
  const { data, fetchExecutionDashboard } = useOverviewStore(
    useShallow((s) => ({
      data: s.executionDashboard,
      fetchExecutionDashboard: s.fetchExecutionDashboard,
    })),
  );
  useEffect(() => {
    fetchExecutionDashboard(days);
  }, [days, fetchExecutionDashboard]);

  const rows = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const pt of data.daily_points || []) {
      for (const pc of pt.persona_costs || []) {
        totals.set(pc.persona_name, (totals.get(pc.persona_name) || 0) + pc.cost);
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }, [data, limit]);

  const max = rows[0]?.[1] ?? 0;

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-3">
        {title ?? `Top personas by cost (last ${days}d)`}
      </div>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption text-foreground/40">
          No data
        </div>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto">
          {rows.map(([name, cost]) => (
            <li key={name} className="flex items-center gap-3">
              <span className="flex-1 typo-caption truncate text-foreground/85">{name}</span>
              <div className="w-20 h-1.5 bg-foreground/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500"
                  style={{ width: `${max > 0 ? (cost / max) * 100 : 0}%` }}
                />
              </div>
              <span className="typo-caption text-foreground/60 tabular-nums w-16 text-right">
                ${cost.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
