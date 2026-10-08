/**
 * The selected goal's detail, inline - the goal-detail model and its blocks
 * WITHOUT the modal. `GoalDetailDrawer` is a shell over `useGoalDetail` + a
 * context + blocks that read it; none of the blocks used here needs
 * `ModalShell`, so this pane is that same composition with a different frame.
 *
 * Left out on purpose: `AcceptanceGate` and `Handoff` (GoalMoves owns those
 * exits, so their writes also refresh the portfolio), and the consulting rail
 * (`Outcome`, `Dependencies`, `ActivityFeed`) - the drawer is one press away
 * ("open full") for that depth.
 *
 * Mount it under `key={goal.id}`: the first-load latch belongs to one goal.
 */
import { Maximize2, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { useProgressView } from '../../canvasHost';
import { GoalDetailProvider } from '../../../goalDetail/context';
import { useGoalDetail } from '../../../goalDetail/useGoalDetail';
import { Description, ProgressNudge } from '../../../goalDetail/blocks/leadBlocks';
import { Subgoals, Tasks, UatGate } from '../../../goalDetail/blocks/workBlocks';
import { LinkedTeams } from '../../../goalDetail/blocks/contextBlocks';
import { goalStatusLabel, goalStatusMeta } from '../../../goalStatus';
import type { MilestoneCard, ProjectLayer } from '../layerModel';
import { Ghost, GoalBar, useFirstLoad } from './detailParts';
import { formatPct } from '../layerFormat';
import { GoalMoves } from './GoalMoves';

interface GoalPaneProps {
  goal: DevGoal;
  layer: ProjectLayer;
  card: MilestoneCard | null;
  onSelectGoal: (goalId: string | null) => void;
}

export function GoalPane({ goal, layer, card, onSelectGoal }: GoalPaneProps) {
  const { openGoal, dl } = useProgressView();
  const { language } = useTranslation();
  const model = useGoalDetail({
    isOpen: true,
    goalId: goal.id,
    onEdit: (g) => openGoal(g.id),
    onClose: () => onSelectGoal(null),
    // The portfolio holds every project's goals; the store only the active
    // project's. The fallback is what makes a cross-project goal resolve.
    goalFallback: goal,
  });
  const ready = useFirstLoad(model.loading);
  const shown = model.goal ?? goal;
  const meta = goalStatusMeta(shown.status);
  const Icon = meta.icon;

  return (
    <GoalDetailProvider model={model}>
      <section
        className="rounded-card border border-primary/15 bg-card/40 px-4 py-4 flex flex-col gap-4"
        data-testid="layers-detail-goal-pane"
        aria-label={shown.title}
      >
        <header className="flex items-start gap-3">
          <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${meta.tint}`} />
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <h3 className="typo-heading text-foreground break-words">{shown.title}</h3>
            <div className="flex items-center gap-2.5">
              <span className={`typo-label px-2 py-0.5 rounded-full border ${meta.chipClass}`}>
                {goalStatusLabel(dl, shown.status)}
              </span>
              <GoalBar goal={shown} className="flex-1 max-w-40" />
              <span className="typo-caption tabular-nums">{formatPct(shown.progress, language)}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => openGoal(shown.id)}
            aria-label={dl.layers_open_goal}
            icon={<Maximize2 className="w-4 h-4" />}
            data-testid="layers-detail-goal-open-full"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onSelectGoal(null)}
            aria-label={dl.layers_close}
            icon={<X className="w-4 h-4" />}
            data-testid="layers-detail-goal-close"
          />
        </header>

        <GoalMoves layer={layer} card={card} onDeselect={() => onSelectGoal(null)} />
        <ProgressNudge />

        {ready ? (
          <div className="flex flex-col gap-4">
            <Description />
            <Tasks />
            <UatGate />
            <Subgoals />
            <LinkedTeams />
          </div>
        ) : (
          <Ghost rows={5} testId="layers-detail-goal-ghost" />
        )}
      </section>
    </GoalDetailProvider>
  );
}
