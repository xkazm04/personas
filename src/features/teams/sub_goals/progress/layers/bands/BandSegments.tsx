/**
 * The band's fill area: one segment per bound goal, equal width with small
 * gaps, each a light track of the goal's status colour filled solid to the
 * goal's weight. A milestone with no goal draws a dashed empty track instead -
 * an empty cut has no progress, and a 0% fill would claim one was measured.
 *
 * The area itself lets clicks fall through (`pointer-events-none`) to the
 * band's own door underneath, so a click in a gap opens the milestone; only the
 * segments take the pointer, and a segment opens the milestone WITH its goal.
 */
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusLabel } from '../../../goalStatus';
import { bandSegments, trackColor } from './bandsModel';

export function BandSegments({
  goals,
  testId,
  onOpenGoal,
}: {
  goals: readonly DevGoal[];
  testId: string;
  onOpenGoal: (goalId: string) => void;
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;

  if (goals.length === 0) {
    return (
      <div
        className="pointer-events-none flex-1 min-h-[34px] rounded-input border-2 border-dashed border-primary/15 flex items-center justify-center"
        data-testid={`${testId}-empty-track`}
      >
        <span className="typo-caption text-foreground">{dl.layers_no_goals}</span>
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex-1 min-w-0 flex items-stretch gap-1" data-testid={`${testId}-segments`}>
      {bandSegments(goals).map(({ goal, weight, fill }) => {
        const status = goalStatusLabel(dl, goal.status);
        return (
          <Tooltip
            key={goal.id}
            placement="top"
            content={
              <span className="flex flex-col gap-0.5">
                <span className="typo-body text-foreground">{goal.title}</span>
                <span className="typo-caption">{status}</span>
              </span>
            }
          >
            <Button
              variant="ghost"
              size="xs"
              aria-label={`${goal.title}, ${status}`}
              data-testid={`${testId}-segment-${goal.id}`}
              data-weight={weight}
              onClick={(e) => {
                e.stopPropagation();
                onOpenGoal(goal.id);
              }}
              className="pointer-events-auto flex-1 min-w-[14px] items-stretch hover:-translate-y-px"
              style={{ padding: 0 }}
            >
              <span
                className="relative block h-[34px] w-full overflow-hidden rounded-input"
                style={{ backgroundColor: trackColor(fill), boxShadow: `inset 0 0 0 1px ${trackColor(fill)}` }}
              >
                <span
                  className="absolute inset-y-0 left-0 block transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${weight}%`, backgroundColor: fill }}
                />
              </span>
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}
