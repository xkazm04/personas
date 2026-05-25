import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, X, MapPin, Sparkles } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useThemeStore } from "@/stores/themeStore";
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { storeBus } from '@/lib/storeBus';
import { Button } from '@/features/shared/components/buttons';
import { getActiveTourSteps, getTourById } from '@/stores/slices/system/tourSlice';
import type { SidebarSection } from '@/lib/types/types';
import { getStepColors } from './tourConstants';
import { TourPanelBody } from './TourPanelBody';
import { useTourNarration } from './useTourNarration';
import { TourNarrationButton } from './TourNarrationButton';
import { useTranslation } from '@/i18n/useTranslation';

const DEFAULT_PANEL_WIDTH = 440;

export default function GuidedTour() {
  // Precedence contract — see `src/features/onboarding/README.md`
  // ("Onboarding modal vs Guided Tour"): the modal owns the screen
  // while it is open. The tour panel is a left-rail coach-mark and
  // would otherwise paint underneath the BaseModal scrim, leaving the
  // user with two competing prompts. We early-return null while
  // `onboardingActive` and rely on `tourActive` itself to be untouched
  // — when the modal closes (finish/dismiss), the panel naturally
  // reappears at whatever step it was on.
  const onboardingActive = useSystemStore((s) => s.onboardingActive);
  const tourActive = useSystemStore((s) => s.tourActive);
  const tourResumePending = useSystemStore((s) => s.tourResumePending);
  const tourId = useSystemStore((s) => s.tourActiveTourId);
  const currentIndex = useSystemStore((s) => s.tourCurrentStepIndex);
  const completedSteps = useSystemStore((s) => s.tourStepCompleted);
  const subStepIndex = useSystemStore((s) => s.tourSubStepIndex);
  const advanceTour = useSystemStore((s) => s.advanceTour);
  const goToTourStep = useSystemStore((s) => s.goToTourStep);
  const dismissTour = useSystemStore((s) => s.dismissTour);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const setEventBusTab = useSystemStore((s) => s.setEventBusTab);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const captureAppearanceBaseline = useSystemStore((s) => s.captureAppearanceBaseline);
  const setHighlightTestId = useSystemStore((s) => s.setHighlightTestId);

  const { t, tx } = useTranslation();
  const [isMinimized, setIsMinimized] = useState(false);
  // Track pending setTimeouts so they can be cleared on dismissal/unmount.
  // Without this, a queued advance/highlight can fire after the tour ends and
  // navigate to a stale step index or set a highlight that's never dismissed.
  const pendingTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const tourActiveRef = useRef(tourActive);
  tourActiveRef.current = tourActive;

  const scheduleTourTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimeouts.current.delete(id);
      if (!tourActiveRef.current) return;
      fn();
    }, ms);
    pendingTimeouts.current.add(id);
    return id;
  }, []);

  const clearPendingTimeouts = useCallback(() => {
    pendingTimeouts.current.forEach((id) => clearTimeout(id));
    pendingTimeouts.current.clear();
  }, []);

  useEffect(() => {
    if (!tourActive) clearPendingTimeouts();
  }, [tourActive, clearPendingTimeouts]);

  useEffect(() => () => clearPendingTimeouts(), [clearPendingTimeouts]);

  const tourDef = getTourById(tourId);
  const visibleSteps = getActiveTourSteps(tourId);
  const currentStep = visibleSteps[currentIndex];
  const isStepCompleted = currentStep ? (completedSteps[currentStep.id] ?? false) : false;
  const allCompleted = visibleSteps.every((s) => completedSteps[s.id] ?? false);
  const completedCount = visibleSteps.filter((s) => completedSteps[s.id]).length;
  const panelWidth = currentStep?.panelWidth ?? DEFAULT_PANEL_WIDTH;

  // Athena-narrated tour (prototype): speak each step via live TTS when the
  // companion's voice is configured. Silent + inert otherwise. Called
  // unconditionally (before the early returns below) to respect hook rules.
  const narration = useTourNarration({
    active: tourActive && !isMinimized && !onboardingActive,
    stepId: currentStep?.id ?? null,
    narration: currentStep?.narration,
  });

  const navigateToStep = useCallback(
    (stepIndex: number) => {
      const steps = getActiveTourSteps(tourId);
      const step = steps[stepIndex];
      if (!step) return;

      setSidebarSection(step.nav.sidebarSection as SidebarSection);

      // Handle sub-tab setters
      if (step.nav.subTab && step.nav.subTabSetter) {
        scheduleTourTimeout(() => {
          if (step.nav.subTabSetter === 'setSettingsTab') {
            setSettingsTab(step.nav.subTab as Parameters<typeof setSettingsTab>[0]);
          } else if (step.nav.subTabSetter === 'setOverviewTab') {
            setOverviewTab(step.nav.subTab as Parameters<typeof setOverviewTab>[0]);
          } else if (step.nav.subTabSetter === 'setEventBusTab') {
            setEventBusTab(step.nav.subTab as Parameters<typeof setEventBusTab>[0]);
          }
        }, 100);
      }

      // Step-specific navigation for getting-started tour
      if (step.id === 'appearance-setup') {
        const theme = useThemeStore.getState();
        captureAppearanceBaseline({ themeId: theme.themeId, textScale: theme.textScale, brightness: theme.brightness });
      } else if (step.id === 'credentials-intro') {
        scheduleTourTimeout(() => storeBus.emit('tour:navigate-credential-view', { key: 'from-template' }), 150);
      } else if (step.id === 'persona-creation') {
        scheduleTourTimeout(() => useSystemStore.setState({ isCreatingPersona: true }), 150);
      } else if (step.id === 'first-execution') {
        // Open the agent we just built on its Use Cases tab so the user can
        // run it by hand. Prefer the tour-recorded persona; fall back to the
        // currently-selected one (promote already selects the new agent).
        // selectPersona emits persona:selected (which routes to the Activity
        // tab), so flip to use-cases just after it settles.
        const createdId = useSystemStore.getState().tourCreatedPersonaId
          ?? useAgentStore.getState().selectedPersona?.id
          ?? null;
        if (createdId) useAgentStore.getState().selectPersona(createdId);
        scheduleTourTimeout(() => useSystemStore.getState().setEditorTab('use-cases'), 300);
      }

      // Set initial spotlight
      const firstSubHighlight = step.subSteps[0]?.highlightTestId;
      if (step.highlightTestId) {
        scheduleTourTimeout(() => setHighlightTestId(step.highlightTestId!), 300);
      } else if (firstSubHighlight) {
        scheduleTourTimeout(() => setHighlightTestId(firstSubHighlight), 300);
      }
    },
    [tourId, setSidebarSection, setSettingsTab, setEventBusTab, setOverviewTab, captureAppearanceBaseline, setHighlightTestId, scheduleTourTimeout],
  );

  useEffect(() => {
    // While a resume is pending, hold the route still and show the
    // "continue where you left off" window first — navigating only after the
    // user confirms (which clears tourResumePending).
    if (!tourActive || isMinimized || tourResumePending) return;
    navigateToStep(currentIndex);
  }, [currentIndex, tourActive, navigateToStep, isMinimized, tourResumePending]);

  const handleNext = () => {
    if (allCompleted) { useSystemStore.getState().finishTour(); return; }
    advanceTour();
  };
  const handlePrev = () => {
    if (currentIndex > 0) useSystemStore.setState({ tourCurrentStepIndex: currentIndex - 1, tourSubStepIndex: 0 });
  };
  const handleJump = (index: number) => {
    goToTourStep(index);
  };

  if (!tourActive || !currentStep || !tourDef) return null;
  // Modal-owns-screen precedence (see README "Onboarding modal vs Guided Tour").
  if (onboardingActive) return null;
  const colors = getStepColors(tourDef.color);

  // Resume interstitial — shown when the tour was resumed (e.g. footer button).
  // The route is intentionally NOT changed yet; clicking Continue clears the
  // pending flag, which lets the navigate effect run and redirect.
  if (tourResumePending) {
    return (
      <div
        data-testid="tour-resume-interstitial"
        className="animate-fade-slide-in fixed left-0 top-[36px] bottom-0 z-[9999]"
        style={{ width: panelWidth }}
      >
        <div className={`h-full rounded-none rounded-r-2xl border border-l-0 ${colors.accent} bg-background shadow-elevation-4 ${colors.glow} overflow-hidden flex flex-col`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/8">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-modal ${colors.subtle} border ${colors.accent} flex items-center justify-center`}>
                <Sparkles className={`w-4 h-4 ${colors.text}`} />
              </div>
              <div>
                <h3 className="typo-heading text-foreground/90 leading-tight">{tourDef.title}</h3>
                <p className="typo-caption text-foreground">{tx(t.onboarding.tour_step_of, { current: currentIndex + 1, total: visibleSteps.length })}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={dismissTour} title={t.onboarding.end_tour} data-testid="tour-resume-dismiss">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className={`w-12 h-12 rounded-modal ${colors.subtle} border ${colors.accent} flex items-center justify-center`}>
              <MapPin className={`w-6 h-6 ${colors.text}`} />
            </div>
            <div>
              <p className="typo-heading text-foreground/90">{t.onboarding.resume_continue_title}</p>
              <p className="typo-body text-foreground mt-1">{currentStep.title}</p>
            </div>
            <Button
              variant="primary"
              onClick={() => useSystemStore.setState({ tourResumePending: false })}
              data-testid="tour-resume-continue"
            >
              {t.onboarding.resume_continue_cta}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isMinimized) {
    return (
      <button
        onClick={() => { setIsMinimized(false); navigateToStep(currentIndex); }}
        data-testid="tour-panel-minimized"
        className={`animate-fade-slide-in fixed left-0 top-[50%] -translate-y-1/2 z-[9999] flex flex-col items-center gap-1.5 px-1.5 py-3 rounded-r-full bg-background border border-l-0 ${colors.accent} shadow-elevation-3 ${colors.glow} hover:shadow-elevation-3 transition-shadow cursor-pointer group`}
      >
        <MapPin className={`w-4 h-4 ${colors.text}`} />
        <span className="typo-caption font-medium text-foreground [writing-mode:vertical-lr]">{completedCount}/{visibleSteps.length}</span>
      </button>
    );
  }

  return (
    <div
      key="tour-panel"
      data-testid="tour-panel"
      className="animate-fade-slide-in fixed left-0 top-[36px] bottom-0 z-[9999]"
      style={{ width: panelWidth }}
    >
      <div className={`h-full rounded-none rounded-r-2xl border border-l-0 ${colors.accent} bg-background shadow-elevation-4 ${colors.glow} overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/8">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-modal ${colors.subtle} border ${colors.accent} flex items-center justify-center`}>
              <Sparkles className={`w-4 h-4 ${colors.text}`} />
            </div>
            <div>
              <h3 className="typo-heading text-foreground/90 leading-tight">{tourDef.title}</h3>
              <p className="typo-caption text-foreground">{tx(t.onboarding.tour_step_of, { current: currentIndex + 1, total: visibleSteps.length })}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <TourNarrationButton control={narration} accentTextClass={colors.text} />
            <Button variant="ghost" size="icon-sm" onClick={() => setIsMinimized(true)} title={t.onboarding.minimize} data-testid="tour-panel-minimize">
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={dismissTour} title={t.onboarding.end_tour} data-testid="tour-panel-dismiss">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <TourPanelBody
          currentIndex={currentIndex}
          completedSteps={completedSteps}
          isStepCompleted={isStepCompleted}
          allCompleted={allCompleted}
          subStepIndex={subStepIndex}
          tourId={tourId}
          tourColor={tourDef.color}
          onNext={handleNext}
          onPrev={handlePrev}
          onJump={handleJump}
        />
      </div>
    </div>
  );
}
