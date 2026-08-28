import { useState } from 'react';
import { GraduationCap, Compass, Check, ChevronRight, Sparkles, RefreshCw } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { TOUR_REGISTRY, type TourDef } from '@/stores/slices/system/tourSlice';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { TOUR_ICONS, getColors } from './data';
import { TourDetailModal } from './TourDetailModal';
import { PowerMovesPanel } from './powerMoves/PowerMovesPanel';
import { useComposedTours, type ComposedTourEntry } from './useComposedTours';

// -- Timeline node ------------------------------------------------------

/**
 * A single node on the guided-tours timeline. Rendered as the right-hand
 * element of each tour row so the node stays vertically centered on its
 * card. The connector segments fill the row (including its vertical
 * padding) so consecutive nodes join into one continuous spine — this
 * replaces the old static `w-px` divider between the two columns.
 */
function TimelineNode({ completed, isFirst, isLast }: { completed: boolean; isFirst: boolean; isLast: boolean }) {
  return (
    <div className="relative flex flex-col items-center w-6 flex-shrink-0 self-stretch" aria-hidden="true">
      <div className={`w-0.5 flex-1 ${isFirst ? 'bg-transparent' : completed ? 'bg-emerald-500/40' : 'bg-primary/15'}`} />
      <div
        className={`my-1 w-3.5 h-3.5 rounded-full flex items-center justify-center border-2 z-10 transition-colors ${
          completed ? 'bg-emerald-500 border-emerald-400' : 'bg-background border-primary/30'
        }`}
      >
        {completed && <Check className="w-2 h-2 text-background" strokeWidth={3} />}
      </div>
      <div className={`w-0.5 flex-1 ${isLast ? 'bg-transparent' : 'bg-primary/15'}`} />
    </div>
  );
}

// -- Compact tour card --------------------------------------------------

function TourCard({ tour, isCompleted, onClick }: { tour: TourDef; isCompleted: boolean; onClick: () => void }) {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  const Icon = TOUR_ICONS[tour.icon] ?? Compass;
  const colors = getColors(tour.color);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`learning-tour-${tour.id}`}
      className={`group w-full text-left flex items-center gap-3 px-3.5 py-2.5 rounded-modal border ${colors.border} ${colors.bg} transition-all hover:shadow-elevation-2 hover:brightness-110`}
    >
      <div className={`w-8 h-8 rounded-card ${colors.bg} border ${colors.border} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-4 h-4 ${colors.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="typo-body text-foreground truncate">{tour.title}</h4>
        <span className="text-[11px] text-foreground">{tx(ht.steps_count, { count: tour.steps.length })}</span>
      </div>
      {isCompleted && (
        <StatusBadge variant="success" size="sm" icon={<Check className="w-2.5 h-2.5" />} className="flex-shrink-0">
          {ht.done}
        </StatusBadge>
      )}
      <ChevronRight className="w-4 h-4 text-foreground group-hover:text-primary transition-colors flex-shrink-0" />
    </button>
  );
}

// -- Athena-composed tour card ------------------------------------------

function ComposedTourCard({
  entry,
  isCompleted,
  onClick,
}: {
  entry: ComposedTourEntry;
  isCompleted: boolean;
  onClick: () => void;
}) {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  const colors = getColors('violet');
  const playable = entry.def !== null;
  const stepCount = entry.def?.steps.length ?? 0;

  const body = (
    <>
      <div className={`w-8 h-8 rounded-card ${colors.bg} border ${colors.border} flex items-center justify-center flex-shrink-0`}>
        <Sparkles className={`w-4 h-4 ${colors.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="typo-body text-foreground truncate">{entry.record.title}</h4>
          <AthenaComposedBadge variant="composed" label={ht.composed_badge} title={entry.record.topic} />
        </div>
        <span className="text-[11px] text-foreground">
          {playable ? tx(ht.steps_count, { count: stepCount }) : ht.composed_stale}
        </span>
      </div>
      {isCompleted && (
        <StatusBadge variant="success" size="sm" icon={<Check className="w-2.5 h-2.5" />} className="flex-shrink-0">
          {ht.done}
        </StatusBadge>
      )}
      {playable && <ChevronRight className="w-4 h-4 text-foreground group-hover:text-primary transition-colors flex-shrink-0" />}
    </>
  );

  if (!playable) {
    // Stale (anchor manifest drifted and re-validation failed): visible but
    // not startable — playing it would spotlight elements that no longer exist.
    return (
      <div
        data-testid={`learning-composed-tour-${entry.record.id}`}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-modal border ${colors.border} ${colors.bg} opacity-60`}
      >
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`learning-composed-tour-${entry.record.id}`}
      className={`group w-full text-left flex items-center gap-3 px-3.5 py-2.5 rounded-modal border ${colors.border} ${colors.bg} transition-all hover:shadow-elevation-2 hover:brightness-110`}
    >
      {body}
    </button>
  );
}

// -- Component ----------------------------------------------------------

export default function HomeLearning() {
  const tourCompletionMap = useSystemStore((s) => s.tourCompletionMap);
  const startTour = useSystemStore((s) => s.startTour);
  const [activeTour, setActiveTour] = useState<TourDef | null>(null);
  const {
    entries: composedTours,
    loading: composedLoading,
    status: composedStatus,
    reload: reloadComposed,
  } = useComposedTours();
  const { t, tx } = useTranslation();
  const ht = t.home.learning;

  // Count only the built-in registry, because that is what the denominator
  // is. `tourCompletionMap` also carries Athena-composed (`athena-*`) tour
  // ids — hydrated at tourSlice.ts:1322 and written by `finishTour` for any
  // active tour — so counting every truthy value rendered "12 of 9" once a
  // user finished a composed tour.
  const completedCount = TOUR_REGISTRY.filter((tour) => tourCompletionMap[tour.id]).length;
  const lastIdx = TOUR_REGISTRY.length - 1;

  return (
    <ContentBox>
      <ContentHeader
        icon={<GraduationCap className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title={ht.title}
        subtitle={ht.subtitle}
      />
      <ContentBody centered>
        {/* 2-column layout: guided tours (with synced timeline) + tricks */}
        {/* Stacks below `lg` — at a narrow window two 50% columns squeezed the
            tour titles and quest rows into permanent truncation. */}
        <div className="flex flex-col lg:flex-row gap-6 w-full">
          {/* Left column: Guided Tours + timeline spine */}
          <div className="w-full lg:w-1/2 lg:flex-shrink-0 min-w-0 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-primary/10">
              <Compass className="w-4 h-4 text-indigo-400" />
              <h3 className="typo-heading text-foreground">{ht.guided_tours}</h3>
              <span className="text-[11px] text-foreground ml-auto">
                {tx(ht.tours_completed, { completed: completedCount, total: TOUR_REGISTRY.length })}
              </span>
            </div>

            <div className="flex flex-col">
              {TOUR_REGISTRY.map((tour, idx) => {
                const isCompleted = tourCompletionMap[tour.id] ?? false;
                return (
                  <div key={tour.id} className="flex items-stretch gap-3 py-1.5">
                    <div className="flex-1 min-w-0">
                      <TourCard tour={tour} isCompleted={isCompleted} onClick={() => setActiveTour(tour)} />
                    </div>
                    <TimelineNode completed={isCompleted} isFirst={idx === 0} isLast={idx === lastIdx} />
                  </div>
                );
              })}
            </div>

            {/* Athena-composed tours (Generative Tours). Rendered beside the
                built-in registry. Loading pattern v2: the section chrome always
                renders, a calm ghost sits UNDER it only while the first fetch is
                in flight with nothing to show, and the honest "none composed
                yet" hint appears only once the fetch has settled — so the
                section no longer pops the timeline down on arrival. */}
            <div className="flex items-center gap-2 pb-2 border-b border-primary/10">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h3 className="typo-heading text-foreground">{ht.composed_tours}</h3>
            </div>
            {composedLoading && composedTours.length === 0 ? (
              <div className="flex flex-col gap-1.5" aria-hidden="true">
                <div className="h-[46px] rounded-modal bg-primary/[0.05]" />
                <div className="h-[46px] rounded-modal bg-primary/[0.05]" />
              </div>
            ) : composedStatus === 'failed' ? (
              /* An IPC/network failure is NOT an empty list. Showing the
                 "none composed yet" hint here told the user Athena had
                 composed nothing, and told the developer nothing at all. */
              <div
                className="flex flex-col items-start gap-2"
                data-testid="learning-composed-failed"
              >
                <p className="typo-caption text-foreground">{ht.composed_failed}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  onClick={reloadComposed}
                >
                  {t.common.retry}
                </Button>
              </div>
            ) : composedTours.length === 0 ? (
              <p className="typo-caption text-foreground">{ht.composed_empty}</p>
            ) : (
              <div className="flex flex-col gap-1.5" data-testid="learning-composed-tours">
                {composedTours.map((entry) => (
                  <ComposedTourCard
                    key={entry.record.id}
                    entry={entry}
                    isCompleted={tourCompletionMap[entry.record.id as TourDef['id']] ?? false}
                    onClick={() => entry.def && setActiveTour(entry.def)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right column: Power Moves quest board */}
          <div className="w-full lg:w-1/2 min-w-0">
            <PowerMovesPanel />
          </div>
        </div>

        {/* Tour detail modal */}
        {activeTour && (
          <TourDetailModal
            tour={activeTour}
            isCompleted={tourCompletionMap[activeTour.id] ?? false}
            onStart={() => {
              const id = activeTour.id;
              setActiveTour(null);
              startTour(id);
            }}
            onClose={() => setActiveTour(null)}
          />
        )}
      </ContentBody>
    </ContentBox>
  );
}
