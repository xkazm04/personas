// The Overseer goal ("All steps green") as a drawn quantity: how many of the
// measurable steps are green, as a figure, and one bar of the measurable
// steps grouped by verdict - green first, then at risk, failing, stale and not
// measured, each group as wide as its steps, in its verdict's fill and stroke
// (not measured is a dashed hollow, stale is hatched). The sentence behind it
// ("3 of 8 measurable steps green, 2 instructed") is what a reader hears and
// what the bar's tip says. Renders nothing while the project has no goal.
// It sits on the Overseer's goal line in the status plate (`overseer/GoalPanel`), one control
// tall: the line names the goal and counts his items, so the meter is the
// figure at row size and the bar, nothing else.
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import { useLifecycleViewModel } from '../../context';
import { useTimeTravel } from '../../history/timeTravel';
import { LT } from '../../system/lcType';
import { VERDICT, goalParts, healthCounts, type HealthStep } from '../healthModel';

/** The measurable verdicts, healthiest first; instructed steps are not on the bar. */
const BAR_ORDER: LifecycleHealth[] = ['green', 'amber', 'red', 'stale', 'unmeasured'];

function segmentClass(h: LifecycleHealth): string {
  const v = VERDICT[h];
  if (v.hollow) return 'border border-dashed border-foreground/55';
  return `${v.fill} ${v.hatched ? 'lc1-hatch' : ''}`;
}

export function GoalMeter({ steps }: { steps: HealthStep[] }) {
  const { snapshot, dl, tx } = useLifecycleViewModel();
  const { viewing } = useTimeTravel();
  const goal = snapshot?.goal;
  if (!goal) return null;
  const counts = healthCounts(steps);
  // Viewing a past Measure, the green count is the rail's own (its Gate and Tests as judged then).
  const p = viewing ? { ...goalParts(goal), green: Math.min(counts.green, goal.measurableTotal) } : goalParts(goal);
  const groups = BAR_ORDER.map((h) => ({ h, n: counts[h] })).filter((g) => g.n > 0);
  const sentence = tx(dl.lc1_goal_progress, { green: p.green, total: goal.measurableTotal, instructed: p.instructed });
  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="lc1-goal">
      <span aria-hidden className="flex items-baseline gap-1">
        <Numeric value={p.green} className={`${LT.rowNum} text-status-success`} />
        <span className={LT.metaNum}>/</span>
        <Numeric value={goal.measurableTotal} className={LT.metaNum} />
      </span>
      <Tooltip content={sentence}>
        <span aria-hidden className="flex h-2.5 w-28 gap-0.5" data-testid="lc1-goal-bar">
          {groups.map((g) => (
            <span key={g.h} className={`block h-full rounded-pill ${segmentClass(g.h)}`} style={{ flexGrow: g.n, flexBasis: 0 }} data-segment={g.h} />
          ))}
        </span>
      </Tooltip>
      <span className="sr-only">{sentence}</span>
    </div>
  );
}
