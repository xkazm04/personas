/**
 * L2's header: the milestone named large, its objective under it, the status
 * pill from `milestoneMeta` (the only milestone colour source), the progress
 * DRAWN (ring + per-goal segments) with the numbers written beside it, the
 * target date, the milestone's moves, and Close.
 *
 * `card === null` is the Unassigned view: it says so, draws the unbound goals'
 * figure, and offers no milestone moves (there is no milestone to move).
 */
import { CalendarClock, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { useNotePlan } from '@/features/notepad/plan/NotePlanContext';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { useProgressView } from '../../canvasHost';
import type { MilestoneCard } from '../layerModel';
import { milestoneMeta } from '../milestoneMeta';
import { formatTarget } from '../layerFormat';
import { MilestoneActions } from './MilestoneActions';
import { GoalSegments, ProgressRing } from './ProgressFigure';

interface DetailHeaderProps {
  card: MilestoneCard | null;
  goals: readonly DevGoal[];
  progress: number | null;
  doneCount: number;
  onClose: () => void;
}

export function DetailHeader({ card, goals, progress, doneCount, onClose }: DetailHeaderProps) {
  const { tx, language } = useTranslation();
  const { dl } = useProgressView();
  const plan = useNotePlan();
  // The plan's read is fresher than the canvas lanes right after a cut/ship.
  const meta = card ? milestoneMeta(dl, plan?.vm?.status ?? card.lane.status) : null;
  const title = card ? card.lane.name : dl.layers_unassigned;
  const subtitle = card ? card.lane.objective : dl.layers_unassigned_hint;

  return (
    <header className="flex flex-col gap-4 px-5 pt-5 pb-4 border-b border-primary/10" data-testid="layers-detail-header">
      <div className="flex items-start gap-4">
        <ProgressRing progress={progress} toneText={meta ? meta.tone.text : 'text-primary'} />

        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {meta && (
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full border typo-label ${meta.tone.bg} ${meta.tone.border} ${meta.tone.text}`}
                data-testid="layers-detail-status"
              >
                {meta.label}
              </span>
            )}
            {card?.lane.targetDate && (
              <span className="inline-flex items-center gap-1.5 typo-caption">
                <CalendarClock className="w-3.5 h-3.5" aria-hidden />
                {tx(dl.layers_target, { date: formatTarget(card.lane.targetDate, language) ?? card.lane.targetDate })}
              </span>
            )}
          </div>
          <h2 className="typo-heading-lg text-foreground break-words">{title}</h2>
          {subtitle && <p className="typo-body text-foreground">{subtitle}</p>}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={dl.layers_close}
          icon={<X className="w-4 h-4" />}
          data-testid="layers-detail-close"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="typo-body text-foreground tabular-nums" data-testid="layers-detail-progress-text">
          {progress === null
            ? dl.layers_no_goals
            : `${tx(dl.layers_progress_pct, { pct: progress })} · ${tx(dl.layers_goals_done, { done: doneCount, total: goals.length })}`}
        </p>
        <GoalSegments goals={goals} />
      </div>

      {card && <MilestoneActions laneStatus={card.lane.status} />}
    </header>
  );
}
