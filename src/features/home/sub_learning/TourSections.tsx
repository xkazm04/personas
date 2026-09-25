import { X } from 'lucide-react';
import { ContextCard, ContextCards, Hint, KitButton, Section, UnitStrip } from '@/features/shared/components/kit';
import type { TourDef } from '@/stores/slices/system/tourSlice';
import { useTranslation } from '@/i18n/useTranslation';
import { TourCard, completedStepsOf, progressOf, PROGRESS_TONE } from './tourCards';
import type { ComposedTourEntry, UseComposedTours } from './useComposedTours';

type Completion = Partial<Record<string, boolean>>;

/** The built-in registry: a level-1 Section whose count and units say how far the user is. */
export function GuidedToursSection({ tours, completion, stepCompleted, onOpen }: {
  tours: TourDef[];
  completion: Completion;
  stepCompleted: Record<string, boolean>;
  onOpen: (tour: TourDef) => void;
}) {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  // Count only the built-in registry, because that is what the denominator is.
  // `tourCompletionMap` also carries Athena-composed (`athena-*`) tour ids, so
  // counting every truthy value rendered "12 of 9" once a user finished one.
  const rows = tours.map((tour) => {
    const completed = completion[tour.id] ?? false;
    const done = completed ? tour.steps.length : completedStepsOf(tour, stepCompleted);
    return { tour, completed, done, progress: progressOf(done, completed) };
  });
  const completedCount = rows.filter((r) => r.completed).length;
  const label = tx(ht.tours_completed, { completed: completedCount, total: tours.length });
  return (
    <Section
      title={ht.guided_tours}
      count={label}
      meta={
        <UnitStrip
          size="m"
          label={label}
          segments={rows.map((r) => ({ n: 1, tone: PROGRESS_TONE[r.progress], glyph: r.progress === 'fresh' ? 'empty' : r.progress === 'done' ? 'solid' : 'soft' }))}
        />
      }
    >
      <ContextCards label={ht.guided_tours}>
        {rows.map(({ tour, completed, done }) => (
          <TourCard
            key={tour.id}
            tour={tour}
            completed={completed}
            done={done}
            title={<span data-testid={`learning-tour-${tour.id}`}>{tour.title}</span>}
            onPress={() => onOpen(tour)}
          />
        ))}
      </ContextCards>
    </Section>
  );
}

/** One composed tour: playable opens its detail; stale is shown muted with a dismiss. */
function ComposedCard({ entry: { record, def }, completion, stepCompleted, onOpen, onDismiss }: {
  entry: ComposedTourEntry;
  completion: Completion;
  stepCompleted: Record<string, boolean>;
  onOpen: (tour: TourDef) => void;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const ht = t.home.learning;
  const title = <span data-testid={`learning-composed-tour-${record.id}`}>{record.title}</span>;
  if (!def) {
    // Stale (anchor manifest drifted and re-validation failed): visible but not
    // startable, and dismissable so the list cannot grow into a pile nobody clears.
    return (
      <TourCard
        tour={{ id: record.id as TourDef['id'], steps: [] }}
        title={title}
        completed={false}
        done={0}
        meta={ht.composed_stale}
        muted={{ markLabel: ht.composed_stale }}
        actions={
          <Hint content={ht.composed_dismiss}>
            <KitButton quiet label={ht.composed_dismiss} testId={`learning-composed-dismiss-${record.id}`} onClick={() => onDismiss(record.id)}>
              <X className="w-3.5 h-3.5" />
            </KitButton>
          </Hint>
        }
      />
    );
  }
  // Invariant behind the cast: `tourCompletionMap` is keyed by `TourDef['id']`, whose
  // dynamic arm is `athena-${string}`, and `validateDynamicTour` rejects any record whose
  // id is not one BEFORE it can be registered, completed, or written into that map. Any
  // other record id simply misses and falls through to `false`.
  const completed = completion[record.id as TourDef['id']] ?? false;
  return (
    <TourCard
      tour={def}
      completed={completed}
      done={completed ? def.steps.length : completedStepsOf(def, stepCompleted)}
      title={title}
      onPress={() => onOpen(def)}
    />
  );
}

/**
 * Athena-composed tours (Generative Tours). Loading pattern v2: the Section chrome
 * always renders, ghost cards sit under it only while the first fetch is in flight
 * with nothing to show, and an empty or failed fetch is the Section's empty band.
 */
export function ComposedToursSection({ composed, completion, stepCompleted, onOpen }: {
  composed: UseComposedTours;
  completion: Completion;
  stepCompleted: Record<string, boolean>;
  onOpen: (tour: TourDef) => void;
}) {
  const { t } = useTranslation();
  const ht = t.home.learning;
  const { entries, total, loading, status, reload, dismiss } = composed;
  const ghost = loading && entries.length === 0;
  // An IPC failure is NOT an empty list, and an emptied list (every outdated record
  // dismissed) is not an unused feature: each says so in its own words.
  const empty = status === 'failed'
    ? {
      title: ht.composed_failed,
      tone: 'error' as const,
      testId: 'learning-composed-failed',
      action: <KitButton onClick={reload}>{t.common.retry}</KitButton>,
    }
    : { title: total > 0 ? ht.composed_all_dismissed : ht.composed_empty };
  return (
    <Section
      title={ht.composed_tours}
      count={entries.length > 0 ? entries.length : undefined}
      state={!ghost && (status === 'failed' || entries.length === 0) ? 'empty' : undefined}
      empty={empty}
    >
      {ghost ? (
        <ContextCards label={ht.composed_tours}>
          {[0, 1].map((i) => <ContextCard key={i} title="" state="loading" />)}
        </ContextCards>
      ) : (
        <div data-testid="learning-composed-tours">
          <ContextCards label={ht.composed_tours}>
            {entries.map((entry) => (
              <ComposedCard
                key={entry.record.id}
                entry={entry}
                completion={completion}
                stepCompleted={stepCompleted}
                onOpen={onOpen}
                onDismiss={dismiss}
              />
            ))}
          </ContextCards>
        </div>
      )}
    </Section>
  );
}
