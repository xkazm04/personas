/**
 * One milestone as a STATION on the track: the ring (its fill), its name in
 * section-title type, the objective and target date as a caption, the status
 * pill, and the bound goals hanging underneath as short readable lines.
 *
 * Colour sources, one each: the ring and pill take `milestoneMeta(...).tone`;
 * a goal's dot takes `goalStatusMeta(...).map.fill`. Nothing here invents one.
 */
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusLabel, goalStatusMeta } from '../../../goalStatus';
import { useProgressView } from '../../canvasHost';
import type { MilestoneCard } from '../layerModel';
import { milestoneMeta } from '../milestoneMeta';
import { formatTarget } from '../layerFormat';
import { StationRing } from './StationRing';

/** How many goal lines a station shows before it says "+N". */
const GOAL_LINES = 5;
export const STATION_W = 200;

export function MilestoneStation({
  card,
  selected,
  onOpen,
  onOpenGoal,
}: {
  card: MilestoneCard;
  selected: boolean;
  onOpen: () => void;
  onOpenGoal: (goalId: string) => void;
}) {
  const { tx, language } = useTranslation();
  const { dl } = useProgressView();
  const { lane, goals, progress, doneCount } = card;
  const meta = milestoneMeta(dl, lane.status);
  const ringLabel =
    progress === null ? `${lane.name}: ${dl.layers_no_goals}` : `${lane.name}: ${tx(dl.layers_progress_pct, { pct: progress })}`;

  return (
    <div className="flex flex-col items-stretch shrink-0 gap-2" style={{ width: STATION_W }} data-testid={`layers-track-station-${lane.id}`}>
      <Button
        variant="ghost"
        onClick={onOpen}
        aria-pressed={selected}
        data-testid={`layers-track-open-${lane.id}`}
        className={`group w-full rounded-card py-3 [&>span]:w-full ${selected ? 'bg-primary/[0.08] ring-1 ring-primary/35' : ''}`}
      >
        <span className="flex flex-col items-center gap-2">
          <span className="relative z-10 rounded-full bg-background transition-transform duration-200 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:transform-none">
            <StationRing progress={progress} toneText={meta.tone.text} label={ringLabel}>
              {progress === null ? (
                <span className="typo-caption leading-tight">{dl.layers_no_goals}</span>
              ) : (
                <span className="typo-data-lg text-foreground">{`${progress}%`}</span>
              )}
            </StationRing>
          </span>
          <span className="typo-section-title text-center line-clamp-2 break-words w-full">{lane.name}</span>
          {lane.objective && (
            <span className="typo-caption text-foreground text-center line-clamp-2 w-full">{lane.objective}</span>
          )}
          <span className="flex flex-wrap items-center justify-center gap-1.5">
            <span className={`typo-caption rounded-full border px-2 py-px ${meta.tone.border} ${meta.tone.bg} ${meta.tone.text}`}>
              {meta.label}
            </span>
            {lane.targetDate && (
              <span className="typo-caption text-foreground tabular-nums">
                {tx(dl.layers_target, { date: formatTarget(lane.targetDate, language) ?? lane.targetDate })}
              </span>
            )}
          </span>
          {goals.length > 0 && (
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.layers_goals_done, { done: doneCount, total: goals.length })}
            </span>
          )}
        </span>
      </Button>
      <GoalLines goals={goals} onOpenGoal={onOpenGoal} onMore={onOpen} testPrefix={lane.id} />
    </div>
  );
}

/** The goals hanging under a station: a coloured dot and a readable title. */
export function GoalLines({
  goals,
  onOpenGoal,
  onMore,
  testPrefix,
}: {
  goals: readonly DevGoal[];
  onOpenGoal: (goalId: string) => void;
  onMore: () => void;
  testPrefix: string;
}) {
  const { tx } = useTranslation();
  const { dl } = useProgressView();
  if (goals.length === 0) return null;
  const shown = goals.slice(0, GOAL_LINES);
  const more = goals.length - shown.length;

  return (
    <ul className="typo-body flex flex-col gap-0.5 border-l border-primary/15 ml-3 pl-2" data-testid={`layers-track-goals-${testPrefix}`}>
      {shown.map((g) => (
        <li key={g.id} className="min-w-0">
          <Tooltip content={`${g.title} - ${goalStatusLabel(dl, g.status)}`}>
            <Button
              variant="ghost"
              size="xs"
              icon={<span aria-hidden="true" className="block w-2 h-2 rounded-full" style={{ background: goalStatusMeta(g.status).map.fill }} />}
              onClick={() => onOpenGoal(g.id)}
              data-testid={`layers-track-goal-${g.id}`}
              className="w-full justify-start min-w-0 text-foreground [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
            >
              {g.title}
            </Button>
          </Tooltip>
        </li>
      ))}
      {more > 0 && (
        <li>
          <Tooltip content={tx(dl.layers_goal_count, { count: goals.length })}>
            <Button variant="ghost" size="xs" onClick={onMore} data-testid={`layers-track-goals-more-${testPrefix}`}>
              <span className="typo-caption text-foreground tabular-nums">{`+${more}`}</span>
            </Button>
          </Tooltip>
        </li>
      )}
    </ul>
  );
}
