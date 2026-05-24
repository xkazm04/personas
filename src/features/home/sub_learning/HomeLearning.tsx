import { useState } from 'react';
import { GraduationCap, Compass, Sparkles, Check, ChevronRight } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { TOUR_REGISTRY, type TourDef } from '@/stores/slices/system/tourSlice';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { TRICKS, CATEGORIES, TOUR_ICONS, getColors, type Trick } from './data';
import { TourDetailModal } from './TourDetailModal';
import { TrickModal } from './TrickModal';

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
        <h4 className="typo-body font-medium text-foreground truncate">{tour.title}</h4>
        <span className="text-[11px] text-foreground">{tx(ht.steps_count, { count: tour.steps.length })}</span>
      </div>
      {isCompleted && (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium px-1.5 py-0.5 rounded-input bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
          <Check className="w-2.5 h-2.5" />
          {ht.done}
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-foreground group-hover:text-primary transition-colors flex-shrink-0" />
    </button>
  );
}

// -- Component ----------------------------------------------------------

export default function HomeLearning() {
  const tourCompletionMap = useSystemStore((s) => s.tourCompletionMap);
  const startTour = useSystemStore((s) => s.startTour);
  const [activeTrick, setActiveTrick] = useState<Trick | null>(null);
  const [activeTour, setActiveTour] = useState<TourDef | null>(null);
  const { t, tx } = useTranslation();
  const ht = t.home.learning;

  const completedCount = Object.values(tourCompletionMap).filter(Boolean).length;
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
        <div className="flex gap-6 w-full">
          {/* Left column: Guided Tours + timeline spine */}
          <div className="w-1/2 flex-shrink-0 space-y-4">
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
          </div>

          {/* Right column: Tricks & Tips */}
          <div className="w-1/2 min-w-0 space-y-5">
            <div className="flex items-center gap-2 pb-2 border-b border-primary/10">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h3 className="typo-heading text-foreground">{ht.tricks_tips}</h3>
              <span className="text-[11px] text-foreground ml-auto">{tx(ht.guides_count, { count: TRICKS.length })}</span>
            </div>

            {CATEGORIES.map((cat) => {
              const catTricks = TRICKS.filter((trick) => trick.category === cat.key);
              return (
                <div key={cat.key} className="space-y-2">
                  {/* Category header */}
                  <div className="flex items-center gap-2 pl-1">
                    <cat.icon className={`w-3.5 h-3.5 ${cat.color}`} />
                    <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{ht[cat.labelKey]}</span>
                    <div className="flex-1 h-px bg-primary/5 ml-1" />
                  </div>

                  {/* Tricks in category — compact rows, no subtitle */}
                  {catTricks.map((trick) => (
                    <button
                      key={trick.id}
                      onClick={() => setActiveTrick(trick)}
                      data-testid={`trick-btn-${trick.id}`}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-modal border border-primary/8 bg-secondary/5 hover:bg-secondary/15 hover:border-primary/12 transition-all group"
                    >
                      <div className="w-7 h-7 rounded-card bg-secondary/30 border border-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-secondary/50 transition-colors">
                        <trick.icon className={`w-3.5 h-3.5 ${trick.color}`} />
                      </div>
                      <h4 className="flex-1 min-w-0 typo-body font-medium text-foreground group-hover:text-foreground/90 transition-colors truncate">{trick.title}</h4>
                    </button>
                  ))}
                </div>
              );
            })}
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

        {/* Trick detail modal */}
        {activeTrick && <TrickModal trick={activeTrick} onClose={() => setActiveTrick(null)} />}
      </ContentBody>
    </ContentBox>
  );
}
