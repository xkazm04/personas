/**
 * One step's verdict at every Measure: a row of cells, oldest left, each the
 * verdict's own look from the module's ONE pill table (`system/pillLooks`) -
 * its stroke (solid, dashed for not measured, dotted for stale), its wash and
 * its glyph - so a regression and a recovery read without colour. A Measure
 * where the step has no cell draws an empty dashed slot, never a verdict.
 *
 * Drawn parts only (`aria-hidden`): the column picker over the figure says
 * what each Measure holds. The cells settle in left to right on the project's
 * first entrance (`system/entrance`); a warm remount paints still.
 */
import { motion } from 'framer-motion';

import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { useEntrance } from '../../system/entrance';
import { lcShape } from '../../system/lcSurface';
import { PILL_STROKE, PILL_TONE, VERDICT_LOOK, pillFilled } from '../../system/pillLooks';
import { GLYPH } from '../../system/scales';
import { HIST_ROW, plotStyle } from '../historyGeometry';
import { cellOf } from '../historyModel';

export function VerdictRow({ columns, stepId }: { columns: LifecycleMeasureColumn[]; stepId: string }) {
  const entering = useEntrance();
  return (
    <div aria-hidden className={`grid ${HIST_ROW.verdict}`} style={plotStyle(columns.length)} data-history-row={stepId}>
      {columns.map((c, i) => {
        const cell = cellOf(c, stepId);
        if (!cell) {
          return <span key={c.measureId} className={`mx-0.5 ${lcShape('chip')} border border-dashed border-foreground/30`} data-cell="none" />;
        }
        const look = VERDICT_LOOK[cell.health];
        const tone = PILL_TONE[look.tone];
        const Glyph = look.glyph;
        return (
          <motion.span
            key={c.measureId}
            className={`mx-0.5 flex min-w-0 items-center justify-center ${lcShape('chip')} ${PILL_STROKE[look.stroke]} ${tone.line} ${pillFilled(look.stroke) ? tone.wash : ''} ${tone.ink}`}
            initial={entering ? { opacity: 0, scaleY: 0.4 } : false}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1], delay: entering ? i * 0.025 : 0 }}
            data-cell={cell.health}
          >
            <Glyph className={`${GLYPH.sm} shrink-0`} strokeWidth={2.25} />
          </motion.span>
        );
      })}
    </div>
  );
}
