import type { ReactNode } from 'react';
import { ContextCard, UnitStrip, type Tone } from '@/features/shared/components/kit';
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
 * How a tour's state is drawn, on the card's rail and in its step units. Done is a
 * success; a tour with saved steps is waiting on you to continue, which reads
 * info-blue (the in-progress badge it replaces was the info status, Gate 5).
 */
export const PROGRESS_TONE: Record<TourProgress, Tone> = { done: 'success', progress: 'info', fresh: 'neutral' };

/** A tour's steps as units: the finished ones filled in its state's tone. */
export function StepUnits({ done, total, progress, label }: { done: number; total: number; progress: TourProgress; label: string }) {
  return (
    <UnitStrip
      size="m"
      label={label}
      segments={[
        { n: done, tone: PROGRESS_TONE[progress], glyph: 'solid' },
        { n: Math.max(0, total - done), tone: 'neutral', glyph: 'empty' },
      ]}
    />
  );
}

/**
 * One tour as a kit card: its name at the top and, pinned to the foot, its steps
 * drawn as units beside the done/total figure (what it covers is in its detail). State is the Mark on the rail
 * (done, or in progress); a tour never started carries no mark. The progress
 * figure keeps `learning-tour-progress-<id>` only while the tour is in progress. Anchors
 * are written as data-testid literals because the tour-anchor generator reads only those.
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
  const figures = muted ? undefined : (
    <>
      <StepUnits done={done} total={total} progress={progress} label={tx(ht.steps_count, { count: total })} />
      {progress === 'progress'
        ? <span className="typo-data k-regular k-quiet" data-testid={`learning-tour-progress-${tour.id}`}>{fraction}</span>
        : <span className="typo-data k-regular k-quiet">{fraction}</span>}
    </>
  );
  return (
    <ContextCard
      title={title}
      meta={meta}
      mark={mark}
      figures={figures}
      actions={actions}
      state={muted ? 'muted' : undefined}
      onPress={onPress}
    />
  );
}
