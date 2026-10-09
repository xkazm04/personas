// THE STATUS PLATE: the whole practice in one plate above the rail, two rows.
//
// - Row 1, the lead: the weakest step's sentence, with the whole width to
//   itself, so at 1280 wide it stays one line;
// - Row 2: the verdict counts that double as the rail's highlight filter, and,
//   when the Overseer holds a goal for the project, his goal beside them
//   (`overseer/GoalPanel`: his open items, the goal drawn, the fold). The
//   fold's items open under both rows, inside the plate.
//
// Wave 10 folded the wave-9 goal strip in here: one plate instead of a band, a
// gap and a strip, so the whole rail fits 1280x800 again with a goal.
//
// While a past Measure is viewed (`history/timeTravel`) the plate says so: its
// outline turns to the accent, the lead names the Measure and the way back
// (`TravelLead`), and the goal and counts count that Measure's Gate and Tests.
// The outline keeps its width, so the plate keeps its height.
import { useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { useTimeTravel } from '../../history/timeTravel';
import { TravelLead } from '../../history/TravelLead';
import { GoalItems, GoalLine, useGoalFold } from '../../overseer/GoalPanel';
import { LC_RULE, lcSurface } from '../../system/lcSurface';
import type { HealthStep } from '../healthModel';
import { VerdictFilter } from './VerdictFilter';
import { WeakestLine } from './WeakestLine';

/** The plate's own class (a size container, `status`): shared with its ghost so the two are the same height. */
export const STATUS_BAND = `@container/status flex flex-col ${lcSurface('status')}`;
/** The same plate showing a past Measure: the accent outline at the same width, a faint accent wash. */
const STATUS_BAND_PAST = `@container/status flex flex-col ${lcSurface('status', 'border border-primary/60 bg-primary/8')}`;
/** The second row: the counts, and the goal pushed to the far edge. Shared with the ghost. */
export const STATUS_ROW = `mt-1.5 flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t pt-1.5 ${LC_RULE}`;

export function StatusBand({ steps }: { steps: HealthStep[] }) {
  const { viewing } = useTimeTravel();
  const reduced = useReducedMotion();
  const fold = useGoalFold();
  const headingId = useId();
  const bodyId = useId();
  return (
    <section
      className={`transition-colors duration-200 motion-reduce:transition-none ${viewing ? STATUS_BAND_PAST : STATUS_BAND}`}
      data-testid="lc1-status"
      data-travel={viewing ? 'past' : undefined}
    >
      <div className="min-w-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={viewing ? 'past' : 'now'}
            initial={reduced ? false : { opacity: 0, x: viewing ? -6 : 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? undefined : { opacity: 0, transition: { duration: 0.08 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          >
            {viewing ? <TravelLead column={viewing} /> : <WeakestLine />}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className={STATUS_ROW}>
        <VerdictFilter steps={steps} />
        <span className="ml-auto flex min-w-0 max-w-full">
          <GoalLine steps={steps} fold={fold} headingId={headingId} bodyId={bodyId} />
        </span>
      </div>
      <GoalItems fold={fold} bodyId={bodyId} />
    </section>
  );
}
