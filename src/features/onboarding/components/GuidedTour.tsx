import { useCallback, useEffect, useState, useMemo } from 'react';
import { ChevronRight, X, MapPin, Sparkles } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import { Button } from '@/features/shared/components/buttons';
import { TOUR_STEPS } from '@/stores/slices/system/tourSlice';
import type { SidebarSection } from '@/lib/types/types';
import { STEP_COLORS } from './tourConstants';
import { TourPanelBody } from './TourPanelBody';

/** Steps hidden in simple mode (navigate to sections not visible in simple mode). */
const SIMPLE_HIDDEN_STEPS = new Set(['credentials-catalog']);

export default function GuidedTour() {
  const isSimple = useSimpleMode();
  const tourActive = useSystemStore((s) => s.tourActive);
  const currentIndex = useSystemStore((s) => s.tourCurrentStepIndex);
  const completedSteps = useSystemStore((s) => s.tourStepCompleted);
  const advanceTour = useSystemStore((s) => s.advanceTour);
  const dismissTour = useSystemStore((s) => s.dismissTour);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const setTemplateTab = useSystemStore((s) => s.setTemplateTab);
  const emitTourEvent = useSystemStore((s) => s.emitTourEvent);
  const tourCreatedPersonaId = useSystemStore((s) => s.tourCreatedPersonaId);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

  const [isMinimized, setIsMinimized] = useState(false);

  const visibleSteps = useMemo(
    () => isSimple ? TOUR_STEPS.filter((s) => !SIMPLE_HIDDEN_STEPS.has(s.id)) : TOUR_STEPS,
    [isSimple],
  );

  const currentStep = visibleSteps[currentIndex] ?? TOUR_STEPS[currentIndex];
  const isStepCompleted = currentStep ? completedSteps[currentStep.id] : false;
  const allCompleted = visibleSteps.every((s) => completedSteps[s.id]);
  const completedCount = visibleSteps.filter((s) => completedSteps[s.id]).length;

  const navigateToStep = useCallback(
    (stepIndex: number) => {
      const step = TOUR_STEPS[stepIndex];
      if (!step) return;
      setSidebarSection(step.nav.sidebarSection as SidebarSection);
      if (step.nav.subTab && step.nav.subTabSetter) {
        setTimeout(() => {
          if (step.nav.subTabSetter === 'setOverviewTab') setOverviewTab(step.nav.subTab as Parameters<typeof setOverviewTab>[0]);
          else if (step.nav.subTabSetter === 'setTemplateTab') setTemplateTab(step.nav.subTab as Parameters<typeof setTemplateTab>[0]);
        }, 100);
      }
      if (step.id === 'agent-execution' && tourCreatedPersonaId) {
        setTimeout(() => { selectPersona(tourCreatedPersonaId); setEditorTab('lab'); }, 150);
      }
    },
    [setSidebarSection, setOverviewTab, setTemplateTab, selectPersona, setEditorTab, tourCreatedPersonaId],
  );

  useEffect(() => { if (!tourActive || isMinimized) return; navigateToStep(currentIndex); }, [currentIndex, tourActive, navigateToStep, isMinimized]);

  useEffect(() => {
    if (!tourActive || !currentStep || currentStep.id !== 'overview-messages') return;
    const timer = setTimeout(() => emitTourEvent('tour:messages-viewed'), 3000);
    return () => clearTimeout(timer);
  }, [tourActive, currentStep, emitTourEvent]);

  useEffect(() => {
    if (!tourActive || !currentStep || currentStep.id !== 'credentials-catalog') return;
    const timer = setTimeout(() => emitTourEvent('tour:catalog-explored'), 4000);
    return () => clearTimeout(timer);
  }, [tourActive, currentStep, emitTourEvent]);

  const handleNext = () => { if (allCompleted) { useSystemStore.getState().finishTour(); return; } advanceTour(); };
  const handlePrev = () => { if (currentIndex > 0) useSystemStore.setState({ tourCurrentStepIndex: currentIndex - 1 }); };
  const handleJump = (index: number) => {
    const step = TOUR_STEPS[index];
    if (step?.id === 'template-gallery') useSystemStore.setState({ tourCurrentStepIndex: index, tourSearchPrefill: 'AI Weekly Research' });
    else useSystemStore.setState({ tourCurrentStepIndex: index });
  };

  if (!tourActive || !currentStep) return null;
  const colors = STEP_COLORS[currentStep.id];

  if (isMinimized) {
    return (
      <button
        onClick={() => { setIsMinimized(false); navigateToStep(currentIndex); }}
        className={`animate-fade-slide-in fixed left-0 top-[50%] -translate-y-1/2 z-[9999] flex flex-col items-center gap-1.5 px-1.5 py-3 rounded-r-full bg-background/95 backdrop-blur-xl border border-l-0 ${colors.border} shadow-lg ${colors.glow} hover:shadow-xl transition-shadow cursor-pointer group`}
      >
        <MapPin className={`w-4 h-4 ${colors.text}`} />
        <span className="text-[10px] font-medium text-foreground/80 [writing-mode:vertical-lr]">{completedCount}/{visibleSteps.length}</span>
      </button>
    );
  }

  return (
    <div
        key="tour-panel"
        className="animate-fade-slide-in fixed left-0 top-[36px] bottom-0 z-[9999] w-[380px]"
      >
        <div className={`h-full rounded-none rounded-r-2xl border border-l-0 ${colors.border} bg-background/95 backdrop-blur-xl shadow-2xl ${colors.glow} overflow-hidden flex flex-col`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/8">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                <Sparkles className={`w-4 h-4 ${colors.text}`} />
              </div>
              <div>
                <h3 className="typo-heading text-foreground/90 leading-tight">Guided Tour</h3>
                <p className="text-[11px] text-muted-foreground/80">Step {currentIndex + 1} of {visibleSteps.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => setIsMinimized(true)} title="Minimize">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={dismissTour} title="End tour">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <TourPanelBody
            currentIndex={currentIndex}
            completedSteps={completedSteps}
            isStepCompleted={isStepCompleted}
            allCompleted={allCompleted}
            onNext={handleNext}
            onPrev={handlePrev}
            onJump={handleJump}
          />
        </div>
      </div>
  );
}
