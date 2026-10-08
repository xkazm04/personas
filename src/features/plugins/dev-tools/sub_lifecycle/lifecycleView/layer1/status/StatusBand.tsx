// The status band: the whole practice in one band above the rail. The weakest
// step's sentence leads (it takes the room that is left and wraps before
// anything else does); then the goal as a drawn quantity with its open items;
// then the verdict counts that double as the rail's highlight filter. One row
// at 1920 wide, two at 1280 (the goal and the counts drop under the sentence
// together), never more.
import { lcSurface } from '../../system/lcSurface';
import type { HealthStep } from '../healthModel';
import { GoalMeter } from './GoalMeter';
import { VerdictFilter } from './VerdictFilter';
import { WeakestLine } from './WeakestLine';

/** The band's own class: shared with its ghost so the two are the same height. */
export const STATUS_BAND = `flex flex-wrap items-center gap-x-6 gap-y-1.5 ${lcSurface('plate')}`;

export function StatusBand({ steps }: { steps: HealthStep[] }) {
  return (
    <section className={STATUS_BAND} data-testid="lc1-status">
      <div className="min-w-0 flex-[1_1_22rem]">
        <WeakestLine />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <GoalMeter steps={steps} />
        <VerdictFilter steps={steps} />
      </div>
    </section>
  );
}
