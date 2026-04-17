import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, X, MapPin, Sparkles } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useThemeStore } from "@/stores/themeStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { storeBus } from '@/lib/storeBus';
import { Button } from '@/features/shared/components/buttons';
import { getActiveTourSteps, getTourById } from '@/stores/slices/system/tourSlice';
import type { SidebarSection, EventBusTab } from '@/lib/types/types';
import { getStepColors } from './tourConstants';
import { TourPanelBody } from './TourPanelBody';
import { useTranslation } from '@/i18n/useTranslation';

const DEFAULT_PANEL_WIDTH = 440;

export default function GuidedTour() {
  const tourActive = useSystemStore((s) => s.tourActive);
  const tourId = useSystemStore((s) => s.tourActiveTourId);
  const currentIndex = useSystemStore((s) => s.tourCurrentStepIndex);
  const completedSteps = useSystemStore((s) => s.tourStepCompleted);
  const subStepIndex = useSystemStore((s) => s.tourSubStepIndex);
  const advanceTour = useSystemStore((s) => s.advanceTour);
  const dismissTour = useSystemStore((s) => s.dismissTour);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const captureAppearanceBaseline = useSystemStore((s) => s.captureAppearanceBaseline);
  const setHighlightTestId = useSystemStore((s) => s.setHighlightTestId);

  const { t, tx } = useTranslation();
  const [isMinimized, setIsMinimized] = useState(false);

  const tourDef = getTourById(tourId);
  const visibleSteps = getActiveTourSteps(tourId);
  const currentStep = visibleSteps[currentIndex];
  const isStepCompleted = currentStep ? (completedSteps[currentStep.id] ?? false) : false;
  const allCompleted = visibleSteps.every((s) => completedSteps[s.id] ?? false);
  const completedCount = visibleSteps.filter((s) => completedSteps[s.id]).length;
  const panelWidth = currentStep?.panelWidth ?? DEFAULT_PANEL_WIDTH;

  const navigateToStep = useCallback(
    (stepIndex: number) => {
      const steps = getActiveTourSteps(tourId);
      const step = steps[stepIndex];
      if (!step) return;

      setSidebarSection(step.nav.sidebarSection as SidebarSection);

      // Handle sub-tab setters
      if (step.nav.subTab && step.nav.subTabSetter) {
        setTimeout(() => {
          if (step.nav.subTabSetter === 'setSettingsTab') {
            setSettingsTab(step.nav.subTab as Parameters<typeof setSettingsTab>[0]);
          } else if (step.nav.subTabSetter === 'setOverviewTab') {
            setOverviewTab(step.nav.subTab as Parameters<typeof setOverviewTab>[0]);
          } else if (step.nav.subTabSetter === 'setEventBusTab') {
            useSystemStore.setState({ eventBusTab: step.nav.subTab as EventBusTab });
          }
        }, 100);
      }

      // Step-specific navigation for getting-started tour
      if (step.id === 'appearance-setup') {
        const theme = useThemeStore.getState();
        captureAppearanceBaseline({ themeId: theme.themeId, textScale: theme.textScale, brightness: theme.brightness });
      } else if (step.id === 'credentials-intro') {
        setTimeout(() => storeBus.emit('tour:navigate-credential-view', { key: 'from-template' }), 150);
      } else if (step.id === 'persona-creation') {
        setTimeout(() => useSystemStore.setState({ isCreatingPersona: true }), 150);
      }

      // Set initial spotlight
      const firstSubHighlight = step.subSteps[0]?.highlightTestId;
      if (step.highlightTestId) {
        setTimeout(() => setHighlightTestId(step.highlightTestId!), 300);
      } else if (firstSubHighlight) {
        setTimeout(() => setHighlightTestId(firstSubHighlight), 300);
      }
    },
    [tourId, setSidebarSection, setSettingsTab, setOverviewTab, captureAppearanceBaseline, setHighlightTestId],
  );

  useEffect(() => {
    if (!tourActive || isMinimized) return;
    navigateToStep(currentIndex);
  }, [currentIndex, tourActive, navigateToStep, isMinimized]);

  // Auto-complete time-based steps for observability/events tours
  useEffect(() => {
    if (!tourActive || !currentStep) return;
    const timedSteps = ['tour:dashboard-viewed', 'tour:activity-explored', 'tour:messages-explored',
      'tour:health-explored', 'tour:lab-explored', 'tour:events-viewed',
      'tour:triggers-explored', 'tour:chaining-understood', 'tour:livestream-viewed'];
    if (timedSteps.includes(currentStep.completeOn)) {
      const timer = setTimeout(() => useSystemStore.getState().emitTourEvent(currentStep.completeOn), 5000);
      return () => clearTimeout(timer);
    }
  }, [tourActive, currentStep]);

  const handleNext = () => {
    if (allCompleted) { useSystemStore.getState().finishTour(); return; }
    advanceTour();
  };
  const handlePrev = () => {
    if (currentIndex > 0) useSystemStore.setState({ tourCurrentStepIndex: currentIndex - 1, tourSubStepIndex: 0 });
  };
  const handleJump = (index: number) => {
    useSystemStore.setState({ tourCurrentStepIndex: index, tourSubStepIndex: 0 });
  };

  if (!tourActive || !currentStep || !tourDef) return null;
  const colors = getStepColors(tourDef.color);

  if (isMinimized) {
    return (
      <button
        onClick={() => { setIsMinimized(false); navigateToStep(currentIndex); }}
        data-testid="tour-panel-minimized"
        className={`animate-fade-slide-in fixed left-0 top-[50%] -translate-y-1/2 z-[9999] flex flex-col items-center gap-1.5 px-1.5 py-3 rounded-r-full bg-background/95 backdrop-blur-xl border border-l-0 ${colors.border} shadow-elevation-3 ${colors.glow} hover:shadow-elevation-3 transition-shadow cursor-pointer group`}
      >
        <MapPin className={`w-4 h-4 ${colors.text}`} />
        <span className="text-[10px] font-medium text-foreground/80 [writing-mode:vertical-lr]">{completedCount}/{visibleSteps.length}</span>
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
      <div className={`h-full rounded-none rounded-r-2xl border border-l-0 ${colors.border} bg-background/95 backdrop-blur-xl shadow-elevation-4 ${colors.glow} overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/8">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-modal ${colors.bg} border ${colors.border} flex items-center justify-center`}>
              <Sparkles className={`w-4 h-4 ${colors.text}`} />
            </div>
            <div>
              <h3 className="typo-heading text-foreground/90 leading-tight">{tourDef.title}</h3>
              <p className="text-[11px] text-muted-foreground/80">{tx(t.onboarding.tour_step_of, { current: currentIndex + 1, total: visibleSteps.length })}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
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
