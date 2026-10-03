import type { ReactNode } from 'react';
import { ContextCard, type Tone } from '@/features/shared/components/kit';
import type { TourDef } from '@/stores/slices/system/tourSlice';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Steps of THIS tour the user has already finished.
 *
 * `tourStepCompleted` is the LAST ACTIVE tour's map, so it has to be filtered
 * by this tour's own step ids - counting all truthy values reports another
 * tour's progress (the same trap `TourLauncher` documents).
 */
export function completedStepsOf(tour: TourDef, stepCompleted: Record<string, boolean>): number {
  return tour.steps.filter((s) => stepCompleted[s.id]).length;
}

export type TourProgress = 'done' | 'progress' | 'fresh';

export function progressOf(done: number, completed: boolean): TourProgress {
  if (completed) return 'done';
  return done > 0 ? 'progress' : 'fresh';
}

/**
 * How a tour's state is drawn: on the card's rail, and as the card's own background
 * fill. Done is a success; a tour with saved steps is waiting on you to continue,
 * which reads info-blue (the in-progress badge it replaces was the info status, Gate 5).
 */
export const PROGRESS_TONE: Record<TourProgress, Tone> = { done: 'success', progress: 'info', fresh: 'neutral' };

/**
 * One tour as a kit card, in TWO rows and not three (owner, 2026-10-03: "bars can be
 * represented by card background fill, number of passed tours in right top corner. This
 * way we can get rid of third row. Second row is empty always and can be reduced").
 *
 * So: the name on the first row, the done/total figure in the corner beside it, and the
 * progress itself painted as the card's `fill` - the quantity the step strip used to
 * spend a whole foot row drawing. With no figures left the kit collapses the foot, and
 * the meta line was already conditional, so a guided tour card is its name and its
 * number. State is still the Mark on the rail (done, or in progress); a tour never
 * started carries no mark and no fill, which is what "not started" looks like.
 *
 * The progress figure keeps `learning-tour-progress-<id>` only while the tour is in
 * progress. Anchors are written as data-testid literals because the tour-anchor
 * generator reads only those.
 */
export function TourCard({ tour, title, completed, done, meta, onPress, actions, muted }: {
  tour: Pick<TourDef, 'id' | 'steps'>;
  /** The name; the caller puts the tour's anchor (a data-testid literal) on it. */
  title: ReactNode;
  completed: boolean;
  /** Steps of this tour already done. */
  done: number;
  meta?: ReactNode;
  onPress?: () => void;
  actions?: ReactNode;
  /** An outdated composed tour: shown, not startable. */
  muted?: { markLabel: string };
}) {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  const total = tour.steps.length;
  const progress = progressOf(done, completed);
  const fraction = tx(ht.tour_in_progress, { completed: done, total });
  const mark = muted
    ? { tone: 'warning' as const, glyph: 'hollow' as const, label: muted.markLabel }
    : progress === 'done'
      ? { tone: 'success' as const, glyph: 'solid' as const, label: ht.done }
      : progress === 'progress'
        ? { tone: 'info' as const, glyph: 'soft' as const, label: fraction }
        : undefined;
  // The corner figure, which is what the foot's `done/total` span was. A stale composed
  // tour has no steps to count, so it states nothing.
  const figure = muted
    ? undefined
    : progress === 'progress'
      ? <span data-testid={`learning-tour-progress-${tour.id}`}>{fraction}</span>
      : <span>{fraction}</span>;
  // Progress as the card's background. Only once there IS progress: a fill of 0 draws
  // nothing and would only add a class that says a quantity is being shown.
  const fill = !muted && total > 0 && done > 0
    ? { value: done / total, tone: PROGRESS_TONE[progress] }
    : undefined;
  return (
    <ContextCard
      title={title}
      meta={meta}
      mark={mark}
      fill={fill}
      figure={figure}
      actions={actions}
      state={muted ? 'muted' : undefined}
      onPress={onPress}
    />
  );
}
