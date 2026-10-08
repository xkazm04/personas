/**
 * LAYER 2 - one milestone opened: its brief note and its goals, shared by all
 * three layered prototypes. A variant only chooses the container (`layout`):
 *
 *   panel  a self-contained column beside L1 (the caller fixes ~460px); the
 *          header stays, everything under it scrolls, the goal detail stacks
 *          under the goals list.
 *   full   the whole canvas width; brief + goals on the left, the selected
 *          goal's detail on the right, each column scrolling on its own.
 *
 * The fusion this exists for: the milestone is the unit the filmstrip and the
 * Notepad share, so its brief is READ from the pad and its goals from the
 * portfolio - neither surface is copied.
 *
 * `NotePlanProvider` is mounted HERE and only for a milestone with a brief: it
 * is the pad's heavy plan read (roadmap + criteria), and it is what the
 * decompose and cut / ship moves reuse rather than reimplement.
 */
import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { NotePlanProvider, type PlanTab } from '@/features/notepad/plan/NotePlanContext';
import { useSystemStore } from '@/stores/systemStore';

import { useProgressView } from '../../canvasHost';
import { isComplete } from '../../../goalStatus';
import { milestoneProgress, type MilestoneCard, type ProjectLayer } from '../layerModel';
import { UNASSIGNED } from '../useLayers';
import { BriefSection } from './BriefSection';
import { DetailHeader } from './DetailHeader';
import { Ghost } from './detailParts';
import { GoalList } from './GoalList';
import { GoalPane } from './GoalPane';

export interface MilestoneDetailProps {
  layer: ProjectLayer;
  /** A milestone id of `layer`, or `UNASSIGNED` for the project's unbound goals. */
  milestoneId: string;
  goalId: string | null;
  onSelectGoal: (goalId: string | null) => void;
  onClose: () => void;
  /** `panel` - a side panel beside L1 (~460px); `full` - the whole canvas width. */
  layout: 'panel' | 'full';
}

export function MilestoneDetail(props: MilestoneDetailProps) {
  const { layer, milestoneId } = props;
  const card = milestoneId === UNASSIGNED ? null : (layer.milestones.find((m) => m.lane.id === milestoneId) ?? null);
  const project = useSystemStore((s) => s.projects.find((p) => p.id === layer.projectId) ?? null);
  // The plan pane's tab; the provider requires its host to own it.
  const [tab, setTab] = useState<PlanTab>('plan');

  const body = <DetailBody {...props} card={card} />;
  if (card?.brief && project) {
    return (
      <NotePlanProvider noteId={card.brief.id} milestoneId={card.lane.id} project={project} tab={tab} onTabChange={setTab}>
        {body}
      </NotePlanProvider>
    );
  }
  return body;
}

function DetailBody({ layer, milestoneId, goalId, onSelectGoal, onClose, layout, card }: MilestoneDetailProps & { card: MilestoneCard | null }) {
  const { dl } = useProgressView();
  const unassigned = milestoneId === UNASSIGNED;
  // A milestone id the lanes do not (yet) carry - just created, or a reload in
  // flight. Ghost under the frame rather than claiming it is empty.
  const pending = !unassigned && !card;
  const goals = card ? card.goals : unassigned ? layer.unassigned : [];
  const progress = card ? card.progress : milestoneProgress(goals);
  const doneCount = card ? card.doneCount : goals.filter((g) => isComplete(g.status)).length;

  // The selected goal resolves across the WHOLE project, so a goal that was
  // just moved out of this milestone does not blank the pane mid-render.
  const goal = goalId
    ? ([...layer.milestones.flatMap((m) => m.goals), ...layer.unassigned].find((g) => g.id === goalId) ?? null)
    : null;

  const left: ReactNode = pending ? (
    <Ghost rows={6} testId="layers-detail-ghost" />
  ) : (
    <>
      {card && <BriefSection card={card} projectId={layer.projectId} />}
      <GoalList goals={goals} selectedId={goalId} onSelect={onSelectGoal} />
    </>
  );
  const right: ReactNode = goal ? (
    <GoalPane key={goal.id} goal={goal} layer={layer} card={card} onSelectGoal={onSelectGoal} />
  ) : (
    <p className="typo-body text-foreground rounded-card border border-dashed border-primary/15 px-4 py-6 text-center" data-testid="layers-detail-select-hint">
      {dl.layers_select_goal}
    </p>
  );

  return (
    <div
      className="h-full min-h-0 flex flex-col rounded-card border border-primary/15 bg-card/50 backdrop-blur-sm overflow-hidden"
      data-testid="layers-milestone-detail"
      data-milestone={milestoneId}
      data-layout={layout}
    >
      {pending ? (
        <div className="flex items-start gap-4 px-5 pt-5 pb-4 border-b border-primary/10">
          <div className="flex-1"><Ghost rows={2} /></div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={dl.layers_close} icon={<X className="w-4 h-4" />} data-testid="layers-detail-close" />
        </div>
      ) : (
        <DetailHeader card={card} goals={goals} progress={progress} doneCount={doneCount} onClose={onClose} />
      )}
      {layout === 'panel' ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-5" data-testid="layers-detail-scroll">
          {left}
          {right}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-5 border-r border-primary/10" data-testid="layers-detail-left">
            {left}
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-4" data-testid="layers-detail-right">
            {right}
          </div>
        </div>
      )}
    </div>
  );
}
