/**
 * Every move L2 offers on the selected goal, through the paths that already
 * exist - nothing here writes a goal any other way:
 *
 *   (a) status steps    `systemStore.updateGoal` (the Kanban's and the editor's
 *                       path); `awaiting_acceptance` instead shows the shared
 *                       accept / reject controls over the store's acceptance
 *                       verdicts, which own that exit
 *   (b) move            `MoveToMilestone` -> `canvas.bindGoal`
 *   (c) hand off        the goal-detail model's `advance` / `abort` (team
 *                       assignment), disabled with the reason when the project
 *                       has no team
 *   Athena              "Break down with Athena" -> `buildGoalBreakdownPrompt`
 *                       through `useAskAthena`; she answers in her chat.
 *
 * Every write ends by re-reading both the goal detail and the portfolio, so the
 * strip, the milestone's fill and this pane move together.
 */
import { Sparkles, Users, Square } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { useProgressView } from '../../canvasHost';
import { AcceptRejectControls } from '../../../acceptancePrimitives';
import { useGoalDetailModel } from '../../../goalDetail/context';
import { goalStatusLabel, goalStatusMeta, isComplete, type GoalStatus } from '../../../goalStatus';
import type { MilestoneCard, ProjectLayer } from '../layerModel';
import { buildGoalBreakdownPrompt } from './goalBreakdownPrompt';
import { nextGoalStatuses } from './goalMoveRules';
import { MoveToMilestone } from './MoveToMilestone';

interface GoalMovesProps {
  layer: ProjectLayer;
  card: MilestoneCard | null;
  onDeselect: () => void;
}

export function GoalMoves({ layer, card, onDeselect }: GoalMovesProps) {
  const { tx } = useTranslation();
  const { model: portfolio, dl } = useProgressView();
  const m = useGoalDetailModel();
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const acceptGoal = useSystemStore((s) => s.acceptGoal);
  const rejectGoal = useSystemStore((s) => s.rejectGoal);
  const askAthena = useAskAthena();
  const goal = m.goal;
  if (!goal) return null;

  const settle = async () => {
    await m.refresh();
    portfolio.refresh();
  };
  const step = async (status: GoalStatus) => {
    // `updateGoal` reports its own failure (toast + Sentry) and resolves.
    await updateGoal(goal.id, { status });
    await settle();
  };
  // The verdicts REJECT after the store has already toasted; catch so the
  // click does not leak an unhandled rejection, and skip the re-read.
  const accept = () => void acceptGoal(goal.id).then(settle).catch(silentCatch('LayersDetail.accept'));
  const reject = (comment: string) =>
    void rejectGoal(goal.id, comment).then(settle).catch(silentCatch('LayersDetail.reject'));

  const breakDown = () => {
    askAthena(
      'Goals',
      buildGoalBreakdownPrompt({
        goal,
        milestone: card ? { id: card.lane.id, name: card.lane.name } : null,
        projectName: layer.name,
      }),
    );
    useAthenaStore.getState().setState('open');
  };

  const done = isComplete(goal.status);

  return (
    <div className="flex flex-col gap-3" data-testid="layers-detail-goal-moves">
      {m.awaitingAcceptance && (
        <div className="rounded-card bg-status-success/10 px-3.5 py-3 flex flex-col gap-2">
          <span className="typo-heading text-foreground">{goalStatusLabel(dl, goal.status)}</span>
          <AcceptRejectControls onAccept={accept} onReject={reject} size="sm" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {nextGoalStatuses(goal.status).map((s) => {
          const meta = goalStatusMeta(s);
          const Icon = meta.icon;
          return (
            <Button
              key={s}
              variant="secondary"
              size="sm"
              icon={<Icon className={`w-3.5 h-3.5 ${meta.tint}`} />}
              onClick={() => step(s)}
              data-testid={`layers-detail-step-${s}`}
            >
              {tx(dl.layers_move_status, { status: goalStatusLabel(dl, s) })}
            </Button>
          );
        })}
        <MoveToMilestone goalId={goal.id} layer={layer} currentMilestoneId={card?.lane.id ?? null} onMoved={onDeselect} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!done && !m.awaitingAcceptance && (
          m.hasActiveAssignment ? (
            <Button
              variant="accent"
              tone="warning"
              size="sm"
              icon={<Square className="w-3.5 h-3.5" />}
              loading={m.aborting}
              onClick={async () => { await m.abort(); portfolio.refresh(); }}
              data-testid="layers-detail-handoff-stop"
            >
              {dl.layers_handoff_stop}
            </Button>
          ) : (
            <Button
              variant="accent"
              tone="agent"
              size="sm"
              icon={<Users className="w-3.5 h-3.5" />}
              loading={m.advancing}
              disabled={!m.hasTeam}
              disabledReason={dl.layers_handoff_no_team}
              onClick={async () => { await m.advance(); portfolio.refresh(); }}
              data-testid="layers-detail-handoff"
            >
              {dl.layers_handoff}
            </Button>
          )
        )}
        <Button
          variant="accent"
          tone="highlight"
          size="sm"
          icon={<Sparkles className="w-3.5 h-3.5" />}
          onClick={breakDown}
          data-testid="layers-detail-breakdown"
        >
          {dl.layers_athena_breakdown}
        </Button>
      </div>
    </div>
  );
}
