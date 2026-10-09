/**
 * The milestone bands the Notes variant hands to the Notepad's QuestRoom: one
 * per milestone in plan order, each a header (the milestone's, drawn here) plus
 * its goals (`GoalList`). The brief card itself
 * is the room's - `NoteDeskCard` with every verb the desk has - so this file
 * never draws a note. A milestone without a brief gets the "Start brief" door;
 * goals bound to no milestone close the list as their own band.
 */
import { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { QuestMilestoneGroup } from '@/features/notepad/overview/questlog/QuestRoomBands';

import { useProgressView } from '../../canvasHost';
import type { MilestoneCard, ProjectLayer } from '../layerModel';
import { milestoneMeta } from '../milestoneMeta';
import { formatPct, formatTarget } from '../layerFormat';
import { GoalList } from './GoalList';
import { GoalSegments } from './goalFigures';
import { StartBrief } from './StartBrief';

export const UNASSIGNED_BAND = 'unassigned';

export function useMilestoneGroups(layer: ProjectLayer | null): QuestMilestoneGroup[] {
  const { openGoal } = useProgressView();
  return useMemo(() => {
    if (!layer) return [];
    // The drawer is the goal's full detail and every goal move, already wired.
    const goals = (list: MilestoneCard['goals']) => (
      <GoalList goals={list} selectedId={null} onSelect={(id) => id && openGoal(id)} />
    );
    const groups: QuestMilestoneGroup[] = layer.milestones.map((card) => ({
      id: card.lane.id,
      header: <BandHeader card={card} />,
      brief: card.brief,
      emptyBrief: <StartBrief card={card} projectId={layer.projectId} />,
      aside: goals(card.goals),
    }));
    if (layer.unassigned.length > 0) {
      groups.push({
        id: UNASSIGNED_BAND,
        header: <UnassignedHeader count={layer.unassigned.length} />,
        brief: null,
        aside: goals(layer.unassigned),
      });
    }
    return groups;
  }, [layer, openGoal]);
}

function BandHeader({ card }: { card: MilestoneCard }) {
  const { tx, language } = useTranslation();
  const { dl } = useProgressView();
  const { lane, goals, progress, doneCount } = card;
  const meta = milestoneMeta(dl, lane.status);
  const target = formatTarget(lane.targetDate, language);
  return (
    <header className="flex items-center gap-4 flex-wrap" data-testid={`layers-notes-band-head-${lane.id}`}>
      <div className="min-w-0 flex flex-col">
        <h3 className="typo-section-title m-0 truncate">{lane.name}</h3>
        {lane.objective && <p className="typo-body text-foreground truncate m-0">{lane.objective}</p>}
      </div>
      <span
        className={`inline-flex items-center h-6 px-2 rounded-full border typo-label ${meta.tone.bg} ${meta.tone.border} ${meta.tone.text}`}
      >
        {meta.label}
      </span>
      <div className="ml-auto flex items-center gap-4">
        {target && (
          <span className="inline-flex items-center gap-1.5 typo-body text-foreground">
            <CalendarClock className="w-4 h-4" aria-hidden />
            {tx(dl.layers_target, { date: target })}
          </span>
        )}
        <GoalSegments goals={goals} />
        <span className="typo-body text-foreground tabular-nums">
          {progress === null ? dl.layers_no_goals : tx(dl.layers_goals_done, { done: doneCount, total: goals.length })}
        </span>
        {progress !== null && (
          <span className={`typo-heading tabular-nums ${meta.tone.text}`}>{formatPct(progress, language)}</span>
        )}
      </div>
    </header>
  );
}

function UnassignedHeader({ count }: { count: number }) {
  const { tx } = useTranslation();
  const { dl } = useProgressView();
  return (
    <header className="flex items-center gap-3" data-testid="layers-notes-band-head-unassigned">
      <h3 className="typo-section-title m-0">{dl.layers_unassigned}</h3>
      <span className="typo-body text-foreground">{dl.layers_unassigned_hint}</span>
      <span className="ml-auto typo-body text-foreground tabular-nums">{tx(dl.layers_goal_count, { count })}</span>
    </header>
  );
}
