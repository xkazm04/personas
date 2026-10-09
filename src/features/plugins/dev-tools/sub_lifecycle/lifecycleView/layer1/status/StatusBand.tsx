// The status band: the whole practice in one band above the rail. The weakest
// step's sentence leads (it takes the room that is left and wraps before
// anything else does); then the goal as a drawn quantity with its open items;
// then the verdict counts that double as the rail's highlight filter. One row
// at 1920 wide, two at 1280 (the goal and the counts drop under the sentence
// together), never more.
//
// While a past Measure is viewed (`history/timeTravel`) the band says so: its
// outline turns to the accent, the lead names the Measure and the way back
// (`TravelLead`), and the goal and counts count that Measure's Gate and Tests.
// The outline keeps its width, so the band keeps its height.
import { AnimatePresence, motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { useTimeTravel } from '../../history/timeTravel';
import { TravelLead } from '../../history/TravelLead';
import { lcSurface } from '../../system/lcSurface';
import type { HealthStep } from '../healthModel';
import { GoalMeter } from './GoalMeter';
import { VerdictFilter } from './VerdictFilter';
import { WeakestLine } from './WeakestLine';

const BAND_LAYOUT = 'flex flex-wrap items-center gap-x-6 gap-y-1.5';

/** The band's own class: shared with its ghost so the two are the same height. */
export const STATUS_BAND = `${BAND_LAYOUT} ${lcSurface('plate')}`;
/** The same band showing a past Measure: the accent outline at the same width, a faint accent wash. */
const STATUS_BAND_PAST = `${BAND_LAYOUT} ${lcSurface('plate', 'border border-primary/60 bg-primary/8')}`;

export function StatusBand({ steps }: { steps: HealthStep[] }) {
  const { viewing } = useTimeTravel();
  const reduced = useReducedMotion();
  return (
    <section
      className={`transition-colors duration-200 motion-reduce:transition-none ${viewing ? STATUS_BAND_PAST : STATUS_BAND}`}
      data-testid="lc1-status"
      data-travel={viewing ? 'past' : undefined}
    >
      <div className="min-w-0 flex-[1_1_22rem]">
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
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <GoalMeter steps={steps} />
        <VerdictFilter steps={steps} />
      </div>
    </section>
  );
}
