/**
 * One goal of the plan: what it is trying to learn, how much of it the answers
 * so far cover, and the two moves the person has over it — pin it (a re-plan
 * must keep it) or drop it (stop asking about it; it can be brought back).
 *
 * Coverage is a STEERING signal, never completion: it decides which goal is
 * asked about next. The bar is drawn with `transform: scaleX`, and the number
 * reaches a screen reader through `Numeric`, so no percentage is ever pasted
 * together by hand (census `locale-blind-percent`).
 */

import { Pin, PinOff, RotateCcw, X } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupGoal } from '@/lib/bindings/SetupGoal';

interface PlanGoalRowProps {
  goal: SetupGoal;
  /** The slot or training topic the goal belongs to, already translated. */
  slotLabel: string;
  onPin: (goal: SetupGoal, pinned: boolean) => Promise<void>;
  onDrop: (goal: SetupGoal) => Promise<void>;
  onRestore: (goal: SetupGoal) => Promise<void>;
}

export function PlanGoalRow({ goal, slotLabel, onPin, onDrop, onRestore }: PlanGoalRowProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience.plan;
  const dropped = goal.state === 'dropped';
  const coverage = Math.min(1, Math.max(0, goal.coverage));
  const pinLabel = goal.pinned ? tx.unpin : tx.pin;

  return (
    <li
      className={`rounded-card border px-3 py-2.5 ${dropped ? 'border-foreground/10 opacity-70' : 'border-primary/15 bg-card/60'}`}
      data-testid={`mr-plan-goal-${goal.id}`}
      data-state={goal.state}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="typo-caption text-primary">{slotLabel}</p>
          <p className={`typo-body text-foreground ${dropped ? 'line-through decoration-foreground/30' : ''}`}>
            {goal.title}
          </p>
          {goal.intent && !dropped && <p className="typo-caption">{goal.intent}</p>}
        </div>
        {dropped ? (
          <Tooltip content={tx.restore}>
            <AsyncButton
              variant="ghost"
              size="icon-sm"
              aria-label={tx.restore}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={() => onRestore(goal)}
              data-testid={`mr-plan-restore-${goal.id}`}
            />
          </Tooltip>
        ) : (
          <>
            <Tooltip content={pinLabel}>
              <AsyncButton
                variant="ghost"
                size="icon-sm"
                aria-label={pinLabel}
                aria-pressed={goal.pinned}
                icon={goal.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                onClick={() => onPin(goal, !goal.pinned)}
                data-testid={`mr-plan-pin-${goal.id}`}
              />
            </Tooltip>
            <Tooltip content={tx.drop}>
              <AsyncButton
                variant="ghost"
                size="icon-sm"
                aria-label={tx.drop}
                icon={<X className="w-3.5 h-3.5" />}
                onClick={() => onDrop(goal)}
                data-testid={`mr-plan-drop-${goal.id}`}
              />
            </Tooltip>
          </>
        )}
      </div>
      {!dropped && (
        <div className="mt-2">
          <span aria-hidden className="block h-1 rounded-pill bg-foreground/10 overflow-hidden">
            <span
              className="block h-full w-full origin-left bg-primary transition-transform"
              style={{ transform: `scaleX(${coverage})` }}
              data-testid={`mr-plan-coverage-${goal.id}`}
            />
          </span>
          <span className="sr-only">
            {tx.coverage} <Numeric value={coverage} unit="ratio" precision={0} />
          </span>
        </div>
      )}
    </li>
  );
}

export default PlanGoalRow;
