import { useMemo } from 'react';
import { useCronFireTimesInRange } from '@/features/schedules/libs/useCronPreview';
import { useTranslation } from '@/i18n/useTranslation';

const DAYS_IN_HEATMAP = 30;
// IPC cap: matches the existing schedule-calendar fetch ceiling. For very
// frequent crons (per-minute, etc.) the heatmap will show uniformly-saturated
// cells once the cap binds, which is the correct qualitative read anyway —
// we're surfacing fire-density, not exact counts.
const MAX_FIRES_PER_FETCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CronFireHeatmapProps {
  cronExpression: string;
  timezone?: string;
}

function bucketize(count: number): 'none' | 'low' | 'medium' | 'high' {
  if (count === 0) return 'none';
  if (count <= 4) return 'low';
  if (count <= 20) return 'medium';
  return 'high';
}

const BUCKET_CLASSES = {
  none: 'bg-secondary/30 border-border/15',
  low: 'bg-amber-500/15 border-amber-500/25',
  medium: 'bg-amber-500/35 border-amber-500/40',
  high: 'bg-amber-500/60 border-amber-500/70',
} as const;

export function CronFireHeatmap({ cronExpression, timezone }: CronFireHeatmapProps) {
  const { t, tx } = useTranslation();

  // Window: start of today through 30 days later. Snapping to midnight keeps
  // bucket boundaries aligned with calendar days regardless of when the user
  // is editing.
  const { start, end } = useMemo(() => {
    const startD = new Date();
    startD.setHours(0, 0, 0, 0);
    const endD = new Date(startD);
    endD.setDate(endD.getDate() + DAYS_IN_HEATMAP);
    return { start: startD, end: endD };
  }, []);

  const { runs, loading, error } = useCronFireTimesInRange(
    cronExpression,
    timezone,
    start,
    end,
    MAX_FIRES_PER_FETCH,
  );

  const dayCounts = useMemo(() => {
    const counts = new Array<number>(DAYS_IN_HEATMAP).fill(0);
    for (const run of runs) {
      const idx = Math.floor((run.getTime() - start.getTime()) / DAY_MS);
      if (idx >= 0 && idx < DAYS_IN_HEATMAP) counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return counts;
  }, [runs, start]);

  if (error) return null;
  if (!loading && runs.length === 0) return null;

  const totalFires = runs.length;
  const capped = totalFires === MAX_FIRES_PER_FETCH;
  const lastDate = new Date(end.getTime() - DAY_MS);
  const dateFmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  return (
    <div className="mt-3 p-3 rounded-modal bg-amber-500/5 border border-amber-500/10">
      <div className="flex items-center justify-between mb-2">
        <span className="typo-caption text-foreground font-medium">
          {t.triggers.heatmap_title}
        </span>
        <span className="typo-caption text-foreground tabular-nums">
          {capped
            ? tx(t.triggers.heatmap_total_capped, { count: totalFires })
            : tx(t.triggers.heatmap_total, { count: totalFires })}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-0.5">
        {dayCounts.map((count, i) => {
          const day = new Date(start);
          day.setDate(day.getDate() + i);
          const bucket = bucketize(count);
          return (
            <div
              key={i}
              className={`aspect-square rounded border transition-colors ${BUCKET_CLASSES[bucket]}`}
              title={`${day.toLocaleDateString(undefined, dateFmt)} — ${tx(t.triggers.heatmap_total, { count })}`}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-2 typo-caption text-foreground">
        <span className="tabular-nums">{start.toLocaleDateString(undefined, dateFmt)}</span>
        <span className="flex items-center gap-1">
          <span>{t.triggers.heatmap_legend_less}</span>
          <span className={`w-2.5 h-2.5 rounded border ${BUCKET_CLASSES.none}`} />
          <span className={`w-2.5 h-2.5 rounded border ${BUCKET_CLASSES.low}`} />
          <span className={`w-2.5 h-2.5 rounded border ${BUCKET_CLASSES.medium}`} />
          <span className={`w-2.5 h-2.5 rounded border ${BUCKET_CLASSES.high}`} />
          <span>{t.triggers.heatmap_legend_more}</span>
        </span>
        <span className="tabular-nums">{lastDate.toLocaleDateString(undefined, dateFmt)}</span>
      </div>
    </div>
  );
}
