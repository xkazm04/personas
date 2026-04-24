import { lazy, Suspense } from 'react';
import { ChevronRight, ChevronLeft, Check, ArrowRight } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import type { TourId, TourStepId } from '@/stores/slices/system/tourSlice';
import { getStepColors } from './tourConstants';
import { StepProgress } from './StepProgress';
import { useTranslation } from '@/i18n/useTranslation';

const TourAppearanceContent = lazy(() => import('./steps/TourAppearanceContent'));
const CredentialsTourContent = lazy(() => import('./steps/CredentialsTourContent'));
const PersonaCreationCoach = lazy(() => import('./steps/PersonaCreationCoach'));

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
}

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
}: TourPanelBodyProps) {
  const { t } = useTranslation();
  const steps = getActiveTourSteps(tourId);
  const currentStep = steps[currentIndex];
  if (!currentStep) return null;

  const colors = getStepColors(tourColor);

  // Determine if this step has a specialized content component (Tour 1 only)
  const isGettingStarted = tourId === 'getting-started';
  const hasSpecialContent = isGettingStarted && ['appearance-setup', 'credentials-intro', 'persona-creation'].includes(currentStep.id);

  return (
    <>
      {/* Step progress */}
      <div className="px-4 py-2.5 border-b border-primary/5" data-testid="tour-step-progress">
        <StepProgress steps={steps} currentIndex={currentIndex} completedSteps={completedSteps} onJump={onJump} />
      </div>

      {/* Step header */}
      <div className="px-4 pt-3 pb-2">
        <h4 className="typo-heading text-foreground/90 flex items-center gap-2">
          {currentStep.title}
          {isStepCompleted && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input bg-emerald-500/10 border border-emerald-500/20 typo-body font-medium text-emerald-400">
              <Check className="w-2.5 h-2.5" />
              {t.onboarding.done_button}
            </span>
          )}
        </h4>
        <p className="typo-body text-foreground leading-relaxed mt-1">{currentStep.description}</p>
      </div>

      {/* Sub-step indicators */}
      {currentStep.subSteps.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap items-center gap-1.5">
          {currentStep.subSteps.map((sub, i) => (
            <div
              key={sub.id}
              data-testid={`tour-substep-${sub.id}`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-card text-[11px] transition-all ${
                i < subStepIndex
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : i === subStepIndex
                    ? `${colors.subtle} ${colors.text} font-medium`
                    : 'bg-secondary/20 text-foreground'
              }`}
            >
              {i < subStepIndex ? <Check className="w-2.5 h-2.5" /> : null}
              {sub.label}
            </div>
          ))}
        </div>
      )}

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 pb-3" key={currentStep.id}>
        <Suspense fallback={<div className="py-4 text-center text-foreground typo-body">{t.onboarding.tour_loading}</div>}>
          {/* Tour 1: Getting Started - specialized content */}
          {isGettingStarted && currentStep.id === 'appearance-setup' && <TourAppearanceContent />}
          {isGettingStarted && currentStep.id === 'credentials-intro' && <CredentialsTourContent subStepIndex={subStepIndex} />}
          {isGettingStarted && currentStep.id === 'persona-creation' && <PersonaCreationCoach subStepIndex={subStepIndex} />}

          {/* Tours 2 & 3: Generic informational content */}
          {!hasSpecialContent && (
            <GenericStepContent step={currentStep} subStepIndex={subStepIndex} colors={colors} />
          )}
        </Suspense>
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-primary/8 bg-secondary/5">
        <button
          onClick={onPrev}
          disabled={currentIndex === 0}
          data-testid="tour-btn-prev"
          className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-card border border-primary/10 text-foreground hover:bg-secondary/50 hover:text-foreground/70 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {t.onboarding.back}
        </button>
        <div className="flex items-center gap-2">
          {allCompleted ? (
            <button
              onClick={() => useSystemStore.getState().finishTour()}
              data-testid="tour-btn-finish"
              className="flex items-center gap-1.5 px-4 py-2 typo-heading rounded-modal bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              {t.onboarding.complete_tour}
            </button>
          ) : (
            <button
              onClick={onNext}
              data-testid="tour-btn-next"
              className={`flex items-center gap-1.5 px-4 py-2 typo-heading rounded-modal ${colors.subtle} ${colors.text} border ${colors.accent} hover:brightness-125 transition-all`}
            >
              {isStepCompleted ? t.onboarding.continue_button : t.onboarding.tour_skip}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Generic step content for tours that don't have specialized interactive components */
function GenericStepContent({ step, subStepIndex, colors }: {
  step: { hint: string; subSteps: { id: string; hint: string }[] };
  subStepIndex: number;
  colors: { subtle: string; accent: string; text: string };
}) {
  const { t } = useTranslation();
  const activeHint = step.subSteps[subStepIndex]?.hint ?? step.hint;

  return (
    <div className="space-y-4 mt-2" data-testid="tour-generic-content">
      {/* Active hint callout */}
      <div className={`rounded-modal ${colors.subtle} border ${colors.accent} p-3`}>
        <div className="flex items-start gap-2">
          <ArrowRight className={`w-3.5 h-3.5 ${colors.text} mt-0.5 flex-shrink-0`} />
          <p className={`typo-heading ${colors.text} leading-relaxed`}>{activeHint}</p>
        </div>
      </div>

      {/* Sub-step hints as checklist */}
      {step.subSteps.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] text-foreground uppercase tracking-wider">{t.onboarding.what_to_explore}</span>
          {step.subSteps.map((sub, i) => (
            <div
              key={sub.id}
              className={`flex items-start gap-2.5 p-2.5 rounded-modal border transition-all ${
                i <= subStepIndex
                  ? `${colors.subtle} ${colors.accent}`
                  : 'border-primary/8 bg-secondary/10'
              }`}
            >
              {i < subStepIndex ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
              ) : (
                <div className={`w-3.5 h-3.5 rounded-full border mt-0.5 flex-shrink-0 ${
                  i === subStepIndex ? `${colors.accent} ${colors.subtle}` : 'border-primary/15'
                }`} />
              )}
              <p className={`text-sm leading-relaxed ${i <= subStepIndex ? 'text-foreground' : 'text-foreground'}`}>
                {sub.hint}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Step auto-completion notice */}
      <p className="text-[11px] text-foreground italic text-center">
        {t.onboarding.auto_complete_hint}
      </p>
    </div>
  );
}
