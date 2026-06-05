import { lazy, Suspense } from 'react';
import { ChevronRight, ChevronLeft, Check, ArrowRight, Eye, Crosshair, EyeOff } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { getActiveTourSteps, isExplorationTourEvent, isSafeTourTestId } from '@/stores/slices/system/tourSlice';
import type { TourId, TourStepId, TourStepDef } from '@/stores/slices/system/tourSlice';
import { Button } from '@/features/shared/components/buttons';
import { getStepColors } from './tourConstants';
import { StepProgress } from './StepProgress';
import { TourIntroCard } from './TourIntroCard';
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
  onComplete: () => void;
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
  onComplete,
}: TourPanelBodyProps) {
  const { t } = useTranslation();
  const highlightMissing = useSystemStore((s) => s.tourHighlightMissing);
  const steps = getActiveTourSteps(tourId);
  const currentStep = steps[currentIndex];
  if (!currentStep) return null;

  const colors = getStepColors(tourColor);
  const hasProgress = Object.values(completedSteps).some(Boolean);

  // Determine if this step has a specialized content component (Tour 1 only)
  const isGettingStarted = tourId === 'getting-started';
  const hasSpecialContent = isGettingStarted && ['appearance-setup', 'credentials-intro', 'persona-creation'].includes(currentStep.id);
  const requiresAcknowledge = isExplorationTourEvent(currentStep.completeOn);
  const handleAcknowledge = () => useSystemStore.getState().emitTourEvent(currentStep.completeOn);

  // Re-summon the spotlight for a target — scroll it into view and re-pulse the
  // cut-out. Guarded to only fire when the element is actually mounted: re-firing
  // at a missing testid would trip TourSpotlight's onMissing handler and dismiss
  // the whole tour, so an off-screen target is a no-op rather than a risk.
  const focusHighlight = (testId: string | null | undefined) => {
    if (!testId || !isSafeTourTestId(testId)) return;
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Setting the same value is a Zustand no-op, so clear then re-set on the next
    // tick to force the spotlight to re-measure and pulse around the element.
    const setHighlight = useSystemStore.getState().setHighlightTestId;
    setHighlight(null);
    window.setTimeout(() => setHighlight(testId), 60);
  };

  // "Show me" header control — points at whatever the current step / active
  // sub-step highlights.
  const activeHighlight =
    currentStep.subSteps[subStepIndex]?.highlightTestId ?? currentStep.highlightTestId ?? null;
  const canShowMe = !!activeHighlight && isSafeTourTestId(activeHighlight);
  const handleShowMe = () => focusHighlight(activeHighlight);

  return (
    <>
      {/* Step progress */}
      <div className="px-4 py-2.5 border-b border-primary/5" data-testid="tour-step-progress">
        <StepProgress steps={steps} currentIndex={currentIndex} completedSteps={completedSteps} onJump={onJump} subStepIndex={subStepIndex} />
      </div>

      {/* Step header — aria-live so screen readers announce each step change */}
      <div className="px-4 pt-3 pb-2 border-b border-primary/5" aria-live="polite">
        <div className="flex items-start justify-between gap-2">
          <h4 className="typo-heading text-foreground/90 flex items-center gap-2 min-w-0">
            <span className="truncate">{currentStep.title}</span>
            {isStepCompleted && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input bg-emerald-500/10 border border-emerald-500/20 typo-body font-medium text-emerald-400 flex-shrink-0">
                <Check className="w-2.5 h-2.5" />
                {t.onboarding.done_button}
              </span>
            )}
          </h4>
          {canShowMe && (
            <Button
              variant="ghost"
              size="xs"
              icon={<Crosshair className="w-3 h-3" />}
              onClick={handleShowMe}
              title={t.onboarding.tour_show_me_title}
              data-testid="tour-btn-show-me"
              className={`flex-shrink-0 ${colors.text}`}
            >
              {t.onboarding.tour_show_me}
            </Button>
          )}
        </div>
        <p className="typo-body text-foreground leading-relaxed mt-1">{currentStep.description}</p>
      </div>

      {/* Sub-step indicators — clickable when the sub-step points at an element */}
      {currentStep.subSteps.length > 0 && (
        <div className="px-4 pt-2 pb-2 flex flex-wrap items-center gap-1.5 border-b border-primary/5">
          {currentStep.subSteps.map((sub, i) => {
            const stateClass =
              i < subStepIndex
                ? 'bg-emerald-500/10 text-emerald-400'
                : i === subStepIndex
                  ? `${colors.subtle} ${colors.text} font-medium`
                  : 'bg-secondary/20 text-foreground';
            const locatable = isSafeTourTestId(sub.highlightTestId);
            const inner = (
              <>
                {i < subStepIndex ? <Check className="w-2.5 h-2.5" /> : null}
                {sub.label}
                {locatable && <Crosshair className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100 transition-opacity" />}
              </>
            );
            return locatable ? (
              <button
                key={sub.id}
                type="button"
                onClick={() => focusHighlight(sub.highlightTestId)}
                data-testid={`tour-substep-${sub.id}`}
                title={t.onboarding.tour_locate_title}
                className={`group flex items-center gap-1.5 px-2 py-1 rounded-card typo-caption transition-all cursor-pointer hover:brightness-125 ${stateClass}`}
              >
                {inner}
              </button>
            ) : (
              <div
                key={sub.id}
                data-testid={`tour-substep-${sub.id}`}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-card typo-caption transition-all ${stateClass}`}
              >
                {inner}
              </div>
            );
          })}
        </div>
      )}

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 pb-3" key={currentStep.id}>
        {highlightMissing && (
          <div
            data-testid="tour-target-missing"
            className="mt-2 flex items-start gap-2 rounded-modal border border-amber-500/25 bg-amber-500/10 p-2.5"
          >
            <EyeOff className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="typo-body text-foreground leading-relaxed">{t.onboarding.tour_target_offscreen}</p>
          </div>
        )}
        {currentIndex === 0 && !hasProgress && (
          <TourIntroCard tourId={tourId} stepCount={steps.length} />
        )}
        <Suspense fallback={<div className="py-4 text-center text-foreground typo-body">{t.onboarding.tour_loading}</div>}>
          {/* Tour 1: Getting Started - specialized content */}
          {isGettingStarted && currentStep.id === 'appearance-setup' && <TourAppearanceContent />}
          {isGettingStarted && currentStep.id === 'credentials-intro' && <CredentialsTourContent subStepIndex={subStepIndex} />}
          {isGettingStarted && currentStep.id === 'persona-creation' && <PersonaCreationCoach subStepIndex={subStepIndex} />}

          {/* Tours 2 & 3: Generic informational content */}
          {!hasSpecialContent && (
            <GenericStepContent
              step={currentStep}
              subStepIndex={subStepIndex}
              colors={colors}
              requiresAcknowledge={requiresAcknowledge}
              isStepCompleted={isStepCompleted}
              onAcknowledge={handleAcknowledge}
              onFocusSubStep={focusHighlight}
            />
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
              onClick={onComplete}
              data-testid="tour-btn-finish"
              className="flex items-center gap-1.5 px-4 py-2 typo-heading rounded-modal bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              {t.onboarding.complete_tour}
            </button>
          ) : isStepCompleted ? (
            <button
              onClick={onNext}
              data-testid="tour-btn-next"
              className={`flex items-center gap-1.5 px-4 py-2 typo-heading rounded-modal ${colors.subtle} ${colors.text} border ${colors.accent} hover:brightness-125 transition-all`}
            >
              {t.onboarding.continue_button}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            // Step not yet done: skipping is the *secondary* path (the primary one
            // is performing the step's action), so de-emphasize it — a colored
            // accent button here used to make "Skip" look like the main CTA.
            <button
              onClick={onNext}
              data-testid="tour-btn-next"
              className="flex items-center gap-1.5 px-4 py-2 typo-heading rounded-modal border border-primary/10 text-foreground hover:bg-secondary/50 hover:text-foreground/70 transition-all"
            >
              {t.onboarding.tour_skip_step}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Generic step content for tours that don't have specialized interactive components */
function GenericStepContent({ step, subStepIndex, colors, requiresAcknowledge, isStepCompleted, onAcknowledge, onFocusSubStep }: {
  step: Pick<TourStepDef, 'hint' | 'subSteps'>;
  subStepIndex: number;
  colors: { subtle: string; accent: string; text: string };
  requiresAcknowledge: boolean;
  isStepCompleted: boolean;
  onAcknowledge: () => void;
  onFocusSubStep: (testId: string | null | undefined) => void;
}) {
  const { t } = useTranslation();
  const activeHint = step.subSteps[subStepIndex]?.hint ?? step.hint;
  const showAcknowledgeButton = requiresAcknowledge && !isStepCompleted;

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
          <span className="typo-caption text-foreground uppercase tracking-wider">{t.onboarding.what_to_explore}</span>
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
              <p className="typo-body leading-relaxed text-foreground flex-1">
                {sub.hint}
              </p>
              {isSafeTourTestId(sub.highlightTestId) && (
                <button
                  type="button"
                  onClick={() => onFocusSubStep(sub.highlightTestId)}
                  title={t.onboarding.tour_locate_title}
                  data-testid={`tour-locate-${sub.id}`}
                  className={`flex-shrink-0 mt-0.5 p-1 rounded-card ${colors.text} hover:bg-secondary/40 transition-colors`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showAcknowledgeButton ? (
        <div className="flex flex-col items-center gap-2 pt-1">
          <p className="typo-caption text-foreground italic text-center">
            {t.onboarding.tour_explore_to_continue}
          </p>
          <button
            onClick={onAcknowledge}
            data-testid="tour-btn-acknowledge"
            className={`flex items-center gap-2 px-4 py-2 typo-heading rounded-modal ${colors.subtle} ${colors.text} border ${colors.accent} hover:brightness-125 transition-all`}
          >
            <Eye className="w-3.5 h-3.5" />
            {t.onboarding.tour_acknowledge}
          </button>
        </div>
      ) : (
        <p className="typo-caption text-foreground italic text-center">
          {t.onboarding.auto_complete_hint}
        </p>
      )}
    </div>
  );
}
