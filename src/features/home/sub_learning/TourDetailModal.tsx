import { X, Play, RotateCcw, Check, Compass } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { TourDef } from '@/stores/slices/system/tourSlice';
import { TOUR_ICONS } from './data';
import { getTourIllustration } from './illustrations';

interface TourDetailModalProps {
  tour: TourDef;
  isCompleted: boolean;
  /**
   * Steps of this tour already done. Above zero (and not complete) the CTA is
   * Continue, not Start: `startTour` resumes at the saved cursor, so calling
   * it "Start" described the button's code path and not what it does.
   */
  completedSteps?: number;
  onStart: () => void;
  onClose: () => void;
}

export function TourDetailModal({
  tour,
  isCompleted,
  completedSteps = 0,
  onStart,
  onClose,
}: TourDetailModalProps) {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  const Icon = TOUR_ICONS[tour.icon] ?? Compass;
  const illustration = getTourIllustration(tour.id);

  return (
    <BaseModal isOpen onClose={onClose} titleId={`tour-modal-${tour.id}`} maxWidthClass="max-w-2xl" portal>
      <div
        data-testid={`tour-modal-${tour.id}`}
        className="relative isolate bg-background border border-primary/15 rounded-modal shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Tour-specific decorative background illustration (Leonardo). A faint
            themed wash behind the content — mix-blend-screen drops the
            near-black source background out on any theme, and the mask fades it
            before it reaches the step list so dense text stays legible. */}
        {illustration && (
          <img
            src={illustration}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none select-none absolute inset-0 z-0 h-full w-full object-cover opacity-[0.32] mix-blend-screen"
            style={{
              maskImage: 'linear-gradient(to bottom, #000 0%, #000 26%, rgba(0,0,0,0.3) 62%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 26%, rgba(0,0,0,0.3) 62%, transparent 100%)',
            }}
          />
        )}

        {/* Header */}
        <div className="relative z-10 flex items-start justify-between px-6 py-5 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center shadow-elevation-1">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-0.5">
              {/* Carries the id BaseModal points `aria-labelledby` at — without
                  it the dialog announces as unlabeled. */}
              <h3 id={`tour-modal-${tour.id}`} className="typo-heading text-foreground">{tour.title}</h3>
              <span className="typo-caption">{tx(ht.steps_count, { count: tour.steps.length })}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCompleted && (
              <StatusBadge variant="success" icon={<Check className="w-2.5 h-2.5" />}>
                {ht.done}
              </StatusBadge>
            )}
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t.common.close} icon={<X className="w-4 h-4" />} />
          </div>
        </div>

        {/* Scrollable body */}
        <div className="relative z-10 flex-1 overflow-y-auto p-6 space-y-5">
          <p className="typo-body text-foreground">{tour.description}</p>

          <div className="space-y-3">
            <span className="typo-eyebrow text-primary">{ht.tour_steps_label}</span>
            <ol className="space-y-1">
              {tour.steps.map((step, i) => (
                <li
                  key={step.id}
                  className="flex items-start gap-3 rounded-card px-2.5 py-2 -mx-2.5 transition-colors hover:bg-secondary/40"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center typo-data mt-0.5">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="typo-title">{step.title}</p>
                    <p className="typo-body text-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-end px-6 py-4 border-t border-primary/10 flex-shrink-0">
          <Button
            variant="primary"
            onClick={onStart}
            data-testid={`tour-modal-start-${tour.id}`}
            icon={isCompleted ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          >
            {isCompleted
              ? ht.restart
              : completedSteps > 0
                ? tx(ht.tour_continue, { completed: completedSteps, total: tour.steps.length })
                : ht.start_tour}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
