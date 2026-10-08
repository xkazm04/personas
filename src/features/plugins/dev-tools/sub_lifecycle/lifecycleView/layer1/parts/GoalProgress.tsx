// The Overseer goal ("All steps green") as a quantity: one unit per measurable
// step, green ones filled, the rest hollow, instructed steps as quiet soft
// units after them. Renders nothing while the project has no goal.
import { UnitStrip } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';

import { useLifecycleViewModel } from '../../context';
import { goalParts } from '../healthModel';

export function GoalProgress({ align = 'start' }: { align?: 'start' | 'center' }) {
  const { snapshot, dl, tx } = useLifecycleViewModel();
  const goal = snapshot?.goal;
  if (!goal) return null;
  const p = goalParts(goal);
  const sentence = tx(dl.lc1_goal_progress, { green: p.green, total: goal.measurableTotal, instructed: p.instructed });
  return (
    <div
      className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${align === 'center' ? 'justify-center' : ''}`}
      data-testid="lc1-goal"
    >
      <span className="flex items-baseline gap-1.5">
        <Numeric value={p.green} className="typo-data-lg text-status-success" />
        <span className="typo-heading text-foreground">/</span>
        <Numeric value={goal.measurableTotal} className="typo-heading text-foreground" />
      </span>
      <UnitStrip
        size="l"
        label={sentence}
        segments={[
          { n: p.green, tone: 'success' },
          { n: p.notGreen, tone: 'neutral', glyph: 'hollow' },
          { n: p.instructed, tone: 'neutral', glyph: 'soft' },
        ]}
      />
      <span className="typo-body text-foreground">{sentence}</span>
      {goal.openItems > 0 && (
        <span className="typo-caption">{tx(dl.lc1_goal_open, { count: goal.openItems })}</span>
      )}
    </div>
  );
}
