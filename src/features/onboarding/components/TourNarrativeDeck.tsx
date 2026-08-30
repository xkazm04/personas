import { lazy, Suspense, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronUp, Crosshair, Eye, EyeOff, Volume2 } from 'lucide-react';
import { useTourStore } from '@/stores/tourStore';
import {
  getLocalizedTourSteps,
  isExplorationTourEvent,
  isSafeTourTestId,
  type TourId,
} from '@/stores/slices/system/tourSlice';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getStepColors, getStepIcon, TOUR_DECK_MAX_WIDTH, TOUR_RAIL_WIDTH } from './tourConstants';
import { TourIntroCard } from './TourIntroCard';
import { useTranslation } from '@/i18n/useTranslation';

const TourAppearanceContent = lazy(() => import('./steps/TourAppearanceContent'));
const CredentialsTourContent = lazy(() => import('./steps/CredentialsTourContent'));
const PersonaCreationCoach = lazy(() => import('./steps/PersonaCreationCoach'));

interface TourNarrativeDeckProps {
  tourId: TourId;
  currentIndex: number;
  subStepIndex: number;
  totalSteps: number;
  isStepCompleted: boolean;
  hasProgress: boolean;
  /** Text Athena is speaking right now, or null when narration is idle/unavailable. */
  narrationCaption: string | null;
  /** Scroll the current highlight into view and re-pulse the spotlight. */
  onShowMe: (testId: string | null | undefined) => void;
}

/**
 * The tour's PROSE surface - a card centred over the content area, to the right
 * of the tour rail.
 *
 * Why it exists: everything the tour has to *say* (step description, the active
 * hint, the concept intro, the interactive step content) used to live inside the
 * left panel. That panel was 320-480px wide depending on the step, so the copy
 * both overflowed vertically and made the panel visibly jump width on every
 * Next. Splitting them fixes both at once: the rail keeps a fixed, sidebar-sized
 * footprint (`TOUR_RAIL_WIDTH`) and reads as a table of contents, while the
 * paragraphs get a comfortable measure here.
 *
 * The deck is collapsible to a single title row so it can be pushed out of the
 * way when it sits over the thing a step is pointing at.
 */
export function TourNarrativeDeck({
  tourId,
  currentIndex,
  subStepIndex,
  totalSteps,
  isStepCompleted,
  hasProgress,
  narrationCaption,
  onShowMe,
}: TourNarrativeDeckProps) {
  const { t, tx } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const highlightMissing = useTourStore((s) => s.tourHighlightMissing);

  const steps = getLocalizedTourSteps(t, tourId);
  const currentStep = steps[currentIndex];
  if (!currentStep) return null;

  const colors = getStepColors(currentStep.id);
  const StepIcon = getStepIcon(currentStep.id);

  const isGettingStarted = tourId === 'getting-started';
  const hasSpecialContent =
    isGettingStarted
    && ['appearance-setup', 'credentials-intro', 'persona-creation'].includes(currentStep.id);

  const activeSub = currentStep.subSteps[subStepIndex];
  const activeHint = activeSub?.hint ?? currentStep.hint;
  const activeHighlight = activeSub?.highlightTestId ?? currentStep.highlightTestId ?? null;
  const canShowMe = isSafeTourTestId(activeHighlight);

  const requiresAcknowledge = isExplorationTourEvent(currentStep.completeOn);
  const showAcknowledgeButton = requiresAcknowledge && !isStepCompleted;
  const handleAcknowledge = () => useTourStore.getState().emitTourEvent(currentStep.completeOn);

  return (
    // The wrapper spans the content area only (the rail owns everything left of
    // it) and is pointer-transparent, so the app underneath stays clickable
    // everywhere the card itself isn't. z-9999 matches the rail and sits ABOVE
    // TourSpotlight's z-9998 dimming layer - the deck is what the user reads, so
    // it must never be the thing that gets dimmed.
    <div
      className="fixed top-[44px] right-0 z-[9999] flex justify-center px-6 pointer-events-none"
      style={{ left: TOUR_RAIL_WIDTH }}
    >
      <div
        data-testid="tour-narrative-deck"
        role="region"
        aria-label={t.onboarding.tour_deck_a11y}
        className={`animate-fade-slide-in pointer-events-auto w-full rounded-modal border ${colors.accent} bg-background/95 shadow-elevation-4 ${colors.glow} overflow-hidden flex flex-col`}
        style={{ maxWidth: TOUR_DECK_MAX_WIDTH, maxHeight: 'min(56vh, 620px)' }}
      >
        {/* Title row - always visible, carries the collapse control */}
        <div className="flex items-start gap-2.5 px-4 py-3">
          <div className={`w-7 h-7 rounded-modal ${colors.subtle} border ${colors.accent} flex items-center justify-center flex-shrink-0`}>
            <StepIcon className={`w-3.5 h-3.5 ${colors.text}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="typo-heading text-foreground/90 leading-tight">{currentStep.title}</h4>
              {isStepCompleted && (
                <StatusBadge
                  variant="success"
                  icon={<Check className="w-2.5 h-2.5" />}
                  className="px-1.5 py-0.5 rounded-input typo-caption flex-shrink-0"
                >
                  {t.onboarding.done_button}
                </StatusBadge>
              )}
            </div>
            <p className="typo-caption text-foreground mt-0.5">
              {tx(t.onboarding.tour_step_of, { current: currentIndex + 1, total: totalSteps })}
            </p>
          </div>
          {canShowMe && (
            <Tooltip content={t.onboarding.tour_show_me_title}>
              <button
                type="button"
                onClick={() => onShowMe(activeHighlight)}
                data-testid="tour-deck-show-me"
                className={`flex items-center gap-1.5 px-2 py-1 rounded-card typo-caption border ${colors.accent} ${colors.subtle} ${colors.text} hover:brightness-125 transition-all flex-shrink-0`}
              >
                <Crosshair className="w-3 h-3" />
                {t.onboarding.tour_show_me}
              </button>
            </Tooltip>
          )}
          <Tooltip content={collapsed ? t.onboarding.tour_deck_expand : t.onboarding.tour_deck_collapse}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              data-testid="tour-deck-toggle"
              aria-label={collapsed ? t.onboarding.tour_deck_expand : t.onboarding.tour_deck_collapse}
              aria-expanded={!collapsed}
              className="flex-shrink-0 p-1 rounded-card text-foreground hover:bg-secondary/50 transition-colors"
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
        </div>

        {!collapsed && (
          // `key` on the step id so a step change resets the scroll position
          // instead of leaving the new copy scrolled to the old step's offset.
          <div
            key={currentStep.id}
            className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3 border-t border-primary/8 pt-3"
            aria-live="polite"
          >
            {highlightMissing && (
              <div
                data-testid="tour-target-missing"
                className="flex items-start gap-2 rounded-modal border border-amber-500/25 bg-amber-500/10 p-2.5"
              >
                <EyeOff className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="typo-body text-foreground leading-relaxed">{t.onboarding.tour_target_offscreen}</p>
              </div>
            )}

            {/* Live narration caption - what Athena is speaking, so a narrated
                tour stays usable muted. No-op when voice isn't set up. */}
            {narrationCaption && (
              <div
                data-testid="tour-narration-caption"
                className="flex items-start gap-2 rounded-modal border border-primary/10 bg-secondary/15 p-2.5"
              >
                <Volume2 className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colors.text} animate-pulse`} />
                <p className="typo-body text-foreground leading-relaxed italic">{narrationCaption}</p>
              </div>
            )}

            {currentIndex === 0 && !hasProgress && (
              <TourIntroCard tourId={tourId} stepCount={steps.length} />
            )}

            <p className="typo-body text-foreground leading-relaxed">{currentStep.description}</p>

            {activeHint && (
              <div className={`rounded-modal ${colors.subtle} border ${colors.accent} p-3`}>
                <div className="flex items-start gap-2">
                  <ArrowRight className={`w-3.5 h-3.5 ${colors.text} mt-0.5 flex-shrink-0`} />
                  <p className={`typo-heading ${colors.text} leading-relaxed`}>{activeHint}</p>
                </div>
              </div>
            )}

            {hasSpecialContent && (
              <Suspense fallback={<div className="py-4 text-center text-foreground typo-body">{t.onboarding.tour_loading}</div>}>
                {currentStep.id === 'appearance-setup' && <TourAppearanceContent />}
                {currentStep.id === 'credentials-intro' && <CredentialsTourContent subStepIndex={subStepIndex} />}
                {currentStep.id === 'persona-creation' && <PersonaCreationCoach subStepIndex={subStepIndex} />}
              </Suspense>
            )}

            {!hasSpecialContent && (
              showAcknowledgeButton ? (
                <div className="flex flex-col items-center gap-2 pt-1">
                  <p className="typo-caption text-foreground italic text-center">
                    {t.onboarding.tour_explore_to_continue}
                  </p>
                  <button
                    type="button"
                    onClick={handleAcknowledge}
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
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
