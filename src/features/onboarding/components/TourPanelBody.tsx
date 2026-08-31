import { ChevronRight, ChevronLeft, Check, Crosshair } from 'lucide-react';
import { useTourStore } from "@/stores/tourStore";
import { getLocalizedTourSteps, isSafeTourTestId } from '@/stores/slices/system/tourSlice';
import type { TourId, TourStepId } from '@/stores/slices/system/tourSlice';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getStepColors } from './tourConstants';
import { focusTourHighlight } from './tourHighlight';
import { StepProgress } from './StepProgress';
import { useTranslation } from '@/i18n/useTranslation';

interface TourPanelBodyProps {
  currentIndex: number;
  completedSteps: Record<TourStepId, boolean>;
  isStepCompleted: boolean;
  allCompleted: boolean;
  subStepIndex: number;
  tourId: TourId;
  tourColor: string;
  onNext: () => void;
  onPrev: () => void;
  onJump: (index: number) => void;
  onComplete: () => void;
}

/**
 * Body of the tour RAIL - the narrow left surface pinned to `TOUR_RAIL_WIDTH`.
 *
 * It carries only what stays legible at sidebar width: the step list, the
 * current step's checklist (labels, not hints) and the Back / Skip / Continue
 * controls. Every paragraph - step description, the active hint, the concept
 * intro, the interactive step content - renders in `TourNarrativeDeck` instead.
 * Keeping prose out of here is what stops the rail overflowing; see the deck's
 * docstring for the full rationale.
 */
export function TourPanelBody({
  currentIndex,
  completedSteps,
  isStepCompleted,
  allCompleted,
  subStepIndex,
  tourId,
  tourColor,
  onNext,
  onPrev,
  onJump,
  onComplete,
}: TourPanelBodyProps) {
  const { t } = useTranslation();
  const steps = getLocalizedTourSteps(t, tourId);
  const currentStep = steps[currentIndex];
  if (!currentStep) return null;

  const colors = getStepColors(tourColor);
  const hasSubSteps = currentStep.subSteps.length > 0;

  return (
    <>
      {/* Step list - the tour's table of contents */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5" data-testid="tour-step-progress">
        <span className="typo-caption text-foreground uppercase tracking-wider px-1">
          {t.onboarding.tour_steps_heading}
        </span>
        <div className="mt-1.5">
          <StepProgress
            steps={steps}
            currentIndex={currentIndex}
            completedSteps={completedSteps}
            onJump={onJump}
            subStepIndex={subStepIndex}
          />
        </div>

        {/* Checklist for the current step. Labels only - each item's hint is
            prose and belongs to the deck, which shows the ACTIVE one. Clicking a
            row makes it active there; the crosshair points the spotlight at it. */}
        {hasSubSteps && (
          <div className="mt-4" data-testid="tour-substep-checklist">
            <div className="flex items-center justify-between px-1">
              <span className="typo-caption text-foreground uppercase tracking-wider">
                {t.onboarding.what_to_explore}
              </span>
              {currentStep.subSteps.length > 1 && (
                <div className="flex items-center gap-0.5">
                  <Tooltip content={t.onboarding.tour_substep_prev}>
                    <button
                      type="button"
                      onClick={() => useTourStore.getState().goToSubStep(subStepIndex - 1)}
                      disabled={subStepIndex <= 0}
                      data-testid="tour-substep-prev"
                      aria-label={t.onboarding.tour_substep_prev}
                      className="p-1 rounded-card text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                  </Tooltip>
                  <Tooltip content={t.onboarding.tour_substep_next}>
                    <button
                      type="button"
                      onClick={() => useTourStore.getState().goToSubStep(subStepIndex + 1)}
                      disabled={subStepIndex >= currentStep.subSteps.length - 1}
                      data-testid="tour-substep-next"
                      aria-label={t.onboarding.tour_substep_next}
                      className="p-1 rounded-card text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {currentStep.subSteps.map((sub, i) => {
                const done = i < subStepIndex;
                const active = i === subStepIndex;
                const locatable = isSafeTourTestId(sub.highlightTestId);
                return (
                  <div
                    key={sub.id}
                    data-testid={`tour-substep-${sub.id}`}
                    className={`flex items-center gap-2 rounded-card border transition-all ${
                      active ? `${colors.subtle} ${colors.accent}` : 'border-primary/8 bg-secondary/10'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => useTourStore.getState().goToSubStep(i)}
                      className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 text-left"
                    >
                      {done ? (
                        <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <span
                          className={`w-3 h-3 rounded-full border flex-shrink-0 ${
                            active ? `${colors.accent} ${colors.subtle}` : 'border-primary/15'
                          }`}
                        />
                      )}
                      {/* The rail truncates at ~230px, so the full label needs a
                          reveal - through the shared Tooltip, never `title=`
                          (keyboard- and touch-unreachable, and untranslated by
                          the user agent). */}
                      <Tooltip content={sub.label} placement="right">
                        <span className={`typo-caption truncate ${active ? colors.text : 'text-foreground'}`}>
                          {sub.label}
                        </span>
                      </Tooltip>
                    </button>
                    {locatable && (
                      <Tooltip content={t.onboarding.tour_locate_title}>
                        <button
                          type="button"
                          onClick={() => focusTourHighlight(sub.highlightTestId)}
                          aria-label={t.onboarding.tour_locate_title}
                          data-testid={`tour-locate-${sub.id}`}
                          className={`flex-shrink-0 mr-1 p-1 rounded-card ${colors.text} hover:bg-secondary/40 transition-colors`}
                        >
                          <Crosshair className="w-3 h-3" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between gap-2 px-3 py-3 border-t border-primary/8 bg-secondary/5">
        <button
          type="button"
          onClick={onPrev}
          disabled={currentIndex === 0}
          data-testid="tour-btn-prev"
          className="flex items-center gap-1 px-2.5 py-1.5 typo-caption rounded-card border border-primary/10 text-foreground hover:bg-secondary/50 hover:text-foreground/70 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {t.onboarding.back}
        </button>
        {allCompleted ? (
          <button
            type="button"
            onClick={onComplete}
            data-testid="tour-btn-finish"
            className="flex items-center gap-1 px-3 py-1.5 typo-caption rounded-modal bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors min-w-0"
          >
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{t.onboarding.complete_tour}</span>
          </button>
        ) : isStepCompleted ? (
          <button
            type="button"
            onClick={onNext}
            data-testid="tour-btn-next"
            className={`flex items-center gap-1 px-3 py-1.5 typo-caption rounded-modal ${colors.subtle} ${colors.text} border ${colors.accent} hover:brightness-125 transition-all min-w-0`}
          >
            <span className="truncate">{t.onboarding.continue_button}</span>
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        ) : (
          // Step not yet done: skipping is the *secondary* path (the primary one
          // is performing the step's action), so de-emphasize it - a colored
          // accent button here used to make "Skip" look like the main CTA.
          <button
            type="button"
            onClick={onNext}
            data-testid="tour-btn-next"
            className="flex items-center gap-1 px-3 py-1.5 typo-caption rounded-modal border border-primary/10 text-foreground hover:bg-secondary/50 hover:text-foreground/70 transition-all min-w-0"
          >
            <span className="truncate">{t.onboarding.tour_skip_step}</span>
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        )}
      </div>
    </>
  );
}
