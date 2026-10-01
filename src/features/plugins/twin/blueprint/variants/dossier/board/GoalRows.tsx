/**
 * Dossier (WP9): the plan's goals on the Training board, one row each - the
 * planner's title (user text, wrapping, never clipped), the coverage meter on
 * 0..1 with its percent, and the answered count. A dropped goal keeps its row,
 * dashed, so the plan reads whole. A row opens the goal's full detail (L3).
 */
import type { KeyboardEvent } from 'react';

import { Rows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintGoal } from '../../../blueprintContract';
import { Figure } from '../Figure';
import { GoalMeter } from '../TrainingMarks';

interface GoalRowsProps {
  goals: readonly BlueprintGoal[];
  onOpen: (goalId: string) => void;
  reduced: boolean;
}

export function GoalRows({ goals, onOpen, reduced }: GoalRowsProps) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  const onKey = (goalId: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(goalId);
    }
  };

  return (
    <Rows count={goals.length} empty={{ title: tb.states.emptyTraining, testId: 'dossier-goals-empty' }}>
      {goals.map((g) => {
        const dropped = g.state === 'dropped';
        return (
          <div
            key={g.id}
            role="button"
            tabIndex={0}
            className="dossier-goalrow"
            data-dropped={dropped ? 'true' : undefined}
            data-testid={`dossier-goal-${g.id}`}
            onClick={() => onOpen(g.id)}
            onKeyDown={onKey(g.id)}
          >
            <span className="typo-body dossier-goalrow__title">{g.title}</span>
            <span className="dossier-goalrow__figs">
              <GoalMeter goal={g} reduced={reduced} />
              {dropped ? (
                <span className="typo-label dossier-key">{copy.dropped}</span>
              ) : (
                <Figure value={g.coverage} unit="ratio" reduced={reduced} />
              )}
              <span className="typo-caption">{tx(copy.answered, { count: g.answered })}</span>
            </span>
          </div>
        );
      })}
    </Rows>
  );
}
