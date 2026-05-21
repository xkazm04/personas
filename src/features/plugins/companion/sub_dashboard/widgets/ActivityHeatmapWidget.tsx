import { useEffect, useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';
import { DebtText } from '@/i18n/DebtText';


/**
 * Activity heatmap — calendar grid colored by execution count, GitHub
 * contribution-style. Answers "do I work in bursts?" or "is my agent
 * fleet running continuously vs. spiky" — a *pattern* question that
 * a line chart obscures.
 *
 * No recharts; we render a plain CSS grid. Cells are 12×12 rounded
 * tiles; intensity comes from a 5-step palette keyed off the per-day
 * count relative to the window's max.
 *
 * Athena-facing config:
 *   { "days": 30 | 60 | 90 }   default 30 — clamps to last N days
 */
export function ActivityHeatmapWidget({ config, title }: WidgetProps) {
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

  const cells = useMemo(() => {
    if (!data) return [] as { date: string; count: number; weekday: number }[];
    const points = (data.daily_points || []).slice(-days);
    return points.map((p) => {
      const d = new Date(p.date + 'T00:00:00Z');
      const weekday = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
      return { date: p.date, count: p.total_executions || 0, weekday };
    });
  }, [data, days]);

  const max = useMemo(() => cells.reduce((m, c) => Math.max(m, c.count), 0), [cells]);

  // Group cells into 7-row weeks for a calendar layout (Mon top, Sun
  // bottom). `weeks[col]` is an array of cells indexed by weekday.
  const weeks = useMemo(() => {
    if (cells.length === 0) return [];
    const out: ({ date: string; count: number; weekday: number } | null)[][] = [];
    let week: (typeof cells[number] | null)[] = new Array(7).fill(null);
    let prevWeekday = -1;
    for (const cell of cells) {
      if (cell.weekday <= prevWeekday) {
        out.push(week);
        week = new Array(7).fill(null);
      }
      week[cell.weekday] = cell;
      prevWeekday = cell.weekday;
    }
    out.push(week);
    return out;
  }, [cells]);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground uppercase tracking-wide mb-2">
        {title ?? `Activity heatmap (last ${days}d)`}
      </div>
      <div className="flex-1 min-h-0 overflow-x-auto">
        {cells.length === 0 ? (
          <div className="h-full flex items-center justify-center typo-caption text-foreground">
            <DebtText k="auto_no_data_d802d232" />
          </div>
        ) : (
          <div className="flex gap-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((cell, di) => (
                  <div
                    key={di}
                    title={cell ? `${cell.date}: ${cell.count} runs` : ''}
                    className="w-3 h-3 rounded-interactive"
                    style={{ backgroundColor: cell ? colorFor(cell.count, max) : 'transparent' }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2 typo-caption text-foreground">
        <span>less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <div
            key={t}
            className="w-3 h-3 rounded-interactive"
            style={{ backgroundColor: colorFor(t * (max || 1), max || 1) }}
          />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}

function colorFor(count: number, max: number): string {
  if (max <= 0 || count <= 0) return 'rgba(255,255,255,0.05)';
  const t = Math.min(1, count / max);
  // Cyan ramp 0.15 → 0.95 alpha. Stays on-theme without a palette dep.
  const alpha = 0.15 + t * 0.8;
  return `rgba(6, 182, 212, ${alpha.toFixed(2)})`;
}
