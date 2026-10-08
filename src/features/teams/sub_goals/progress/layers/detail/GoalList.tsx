/**
 * The milestone's goals as readable rows: status icon in the status colour,
 * the title at body-large, and the goal's own fill drawn under it. Pressing a
 * row selects it (pressing the selected one clears it); the selected row is
 * lifted so the inline detail below / beside it reads as belonging to it.
 */
import { Target } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { useProgressView } from '../../canvasHost';
import { Section } from '../../../goalDetail/parts';
import { goalStatusLabel, goalStatusMeta } from '../../../goalStatus';
import { goalWeight } from '../layerModel';
import { GoalBar } from './detailParts';

// The row is a Button so it carries the shared focus ring and press response;
// its label slot is stretched into the row's content column.
const ROW_LAYOUT =
  'w-full text-left [&>span]:flex-1 [&>span]:min-w-0 [&>span]:flex [&>span]:items-center [&>span]:gap-3';

interface GoalListProps {
  goals: readonly DevGoal[];
  selectedId: string | null;
  onSelect: (goalId: string | null) => void;
}

export function GoalList({ goals, selectedId, onSelect }: GoalListProps) {
  const { tx } = useTranslation();
  const { dl } = useProgressView();

  return (
    <Section icon={Target} label={`${dl.layers_goals} · ${tx(dl.layers_goal_count, { count: goals.length })}`} flush>
      {goals.length === 0 ? (
        <p className="typo-body text-foreground px-1 py-2" data-testid="layers-detail-goals-empty">
          {dl.layers_no_goals}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="layers-detail-goals">
          {goals.map((g) => {
            const meta = goalStatusMeta(g.status);
            const Icon = meta.icon;
            const selected = g.id === selectedId;
            return (
              <li key={g.id}>
                <Button
                  variant="ghost"
                  aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : g.id)}
                  data-testid={`layers-detail-goal-${g.id}`}
                  className={`${ROW_LAYOUT} ${selected ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${meta.tint}`} />
                  <span className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <span className="typo-body-lg text-foreground truncate">{g.title}</span>
                    <span className="flex items-center gap-2.5">
                      <GoalBar goal={g} className="flex-1" />
                      <span className="typo-caption tabular-nums shrink-0">{goalWeight(g)}%</span>
                    </span>
                  </span>
                  <span className="sr-only">{goalStatusLabel(dl, g.status)}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
