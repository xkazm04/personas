/**
 * Each Measure's total time (the sum of its runs, child spawn to exit) as a
 * bar standing on the row's floor, all on one scale (the figure's scale
 * column names its top). The viewed Measure's bar is drawn in the full
 * accent, the rest quieter, so the playhead and the bar agree.
 *
 * One outlier must not flatten the rest: a timed-out command's kill time can
 * be ten times a normal Measure. When the slowest Measure is more than
 * `CLIP_FACTOR` times the median, the scale stops there and a bar past it is
 * drawn full height with a break mark at its top (in the warning ink), so it
 * reads as "off the scale", never as a measured height. Drawn parts only
 * (`aria-hidden`); the peek says each time.
 */
import { motion } from 'framer-motion';

import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { median } from '../../presets/gateModel';
import { useEntrance } from '../../system/entrance';
import { HIST_ROW, plotStyle } from '../historyGeometry';

const CLIP_FACTOR = 2.5;

/** The bars' common top, and whether any bar is past it. */
export function durationScale(columns: LifecycleMeasureColumn[]): { top: number; clipped: boolean } {
  const all = columns.map((c) => c.durationMs);
  const max = Math.max(1, ...all);
  const mid = median(all) ?? max;
  const top = max > mid * CLIP_FACTOR ? Math.max(1, mid * CLIP_FACTOR) : max;
  return { top, clipped: max > top };
}

export function DurationRow({ columns, at }: { columns: LifecycleMeasureColumn[]; at: number }) {
  const entering = useEntrance();
  const { top } = durationScale(columns);
  return (
    <div aria-hidden className={`grid border-b ${HIST_ROW.duration} border-primary/15`} style={plotStyle(columns.length)} data-history-row="duration">
      {columns.map((c, i) => {
        const over = c.durationMs > top;
        return (
          <span key={c.measureId} className="relative flex min-w-0 items-end justify-center">
            <motion.span
              className={`block w-2/5 max-w-4 origin-bottom rounded-t-interactive ${i === at ? 'bg-primary' : 'bg-primary/35'}`}
              style={{ height: `${Math.max(6, (Math.min(c.durationMs, top) / top) * 100)}%` }}
              initial={entering ? { scaleY: 0 } : false}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: entering ? 0.1 + i * 0.025 : 0 }}
              data-bar={c.measureId}
              data-over={over || undefined}
            />
            {over && (
              <span className="absolute top-0 left-1/2 flex w-2/5 max-w-4 -translate-x-1/2 flex-col gap-0.5" data-break>
                <span className="block h-0.5 w-full -rotate-12 bg-background" />
                <span className="block h-0.5 w-full -rotate-12 bg-status-warning" />
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
