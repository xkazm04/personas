/**
 * DIRECTION B (Collar rail) - the Tactile rail scaled to the page: the same
 * two recessed trays and key caps on a groove, each tray sharing the page
 * width by its step count, and every key wearing its metric collar beneath
 * it. When the page is too narrow for both trays side by side, the after
 * tray drops under the before tray instead of squeezing the collars.
 *
 * 2026-10-08 (WP4): the owner picked this direction; it is mounted directly
 * by `Layer1`, and the health legend that sat beside the retired direction
 * tabs now sits beside the goal.
 */
import type { CSSProperties } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';

import { useLifecycleViewModel } from '../../context';
import type { HealthStep } from '../healthModel';
import { GoalProgress } from '../parts/GoalProgress';
import { HealthLegend } from '../parts/HealthLegend';
import { StepTrack, useLayer1 } from '../useLayer1';
import { CollarColumn } from './CollarColumn';

/**
 * A collar needs about this much width to keep its figure on one line. 8.5,
 * not 9.5: at 1280 wide the app's content column is ~910px, and six After
 * columns at 9.5rem overflowed it sideways (measured on the WP4 page shots).
 */
const COLUMN_REM = 8.5;

export function CollarView() {
  const { dl } = useLifecycleViewModel();
  const { before, after, all, roving } = useLayer1();

  const tray = (title: string, steps: HealthStep[], offset: number, testId: string) => {
    const n = Math.max(1, steps.length);
    const style: CSSProperties = { flexGrow: n, flexBasis: 0, minWidth: `${n * COLUMN_REM}rem` };
    return (
      <div
        role="group"
        aria-label={title}
        style={style}
        className="flex flex-col gap-3 rounded-modal border border-primary/10 bg-secondary/30 px-3 pb-3 pt-2.5 shadow-inner"
        data-testid={testId}
      >
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="typo-eyebrow text-primary">{title}</span>
          <Numeric value={steps.length} className="typo-caption rounded-full bg-background px-1.5 shadow-elevation-1" />
        </div>
        <ol className="grid items-start gap-2" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => (
            <CollarColumn key={s.node.id} step={s} index={offset + i} roving={roving} first={i === 0} last={i === steps.length - 1} />
          ))}
        </ol>
      </div>
    );
  };

  return (
    <div className="space-y-5" data-testid="lc1-collar">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <GoalProgress />
        <div className="ml-auto">
          <HealthLegend steps={all} />
        </div>
      </div>
      <StepTrack roving={roving} className="flex flex-wrap items-start gap-4">
        {tray(dl.lc_lane_before, before, 0, 'lc-lane-before')}
        {tray(dl.lc_lane_after, after, before.length, 'lc-lane-after')}
      </StepTrack>
    </div>
  );
}
