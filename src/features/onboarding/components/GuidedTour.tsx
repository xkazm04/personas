import { useCallback, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, X, MapPin, Sparkles } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
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
  const tourActive = usePersonaStore((s) => s.tourActive);
  const currentIndex = usePersonaStore((s) => s.tourCurrentStepIndex);
  const completedSteps = usePersonaStore((s) => s.tourStepCompleted);
  const advanceTour = usePersonaStore((s) => s.advanceTour);
  const dismissTour = usePersonaStore((s) => s.dismissTour);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);
  const setTemplateTab = usePersonaStore((s) => s.setTemplateTab);
  const emitTourEvent = usePersonaStore((s) => s.emitTourEvent);
  const tourCreatedPersonaId = usePersonaStore((s) => s.tourCreatedPersonaId);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  const [isMinimized, setIsMinimized] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

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

  const handleNext = () => { if (allCompleted) { usePersonaStore.getState().finishTour(); return; } advanceTour(); };
  const handlePrev = () => { if (currentIndex > 0) usePersonaStore.setState({ tourCurrentStepIndex: currentIndex - 1 }); };
  const handleJump = (index: number) => {
    const step = TOUR_STEPS[index];
    if (step?.id === 'template-gallery') usePersonaStore.setState({ tourCurrentStepIndex: index, tourSearchPrefill: 'AI Weekly Research' });
    else usePersonaStore.setState({ tourCurrentStepIndex: index });
  };

  if (!tourActive || !currentStep) return null;
  const colors = STEP_COLORS[currentStep.id];

  if (isMinimized) {
    return (
      <motion.button
        initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
        onClick={() => { setIsMinimized(false); navigateToStep(currentIndex); }}
        className={`fixed bottom-6 left-[320px] z-[9999] flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/95 backdrop-blur-xl border ${colors.border} shadow-lg ${colors.glow} hover:shadow-xl transition-shadow cursor-pointer group`}
      >
        <MapPin className={`w-4 h-4 ${colors.text}`} />
        <span className="text-sm font-medium text-foreground/80">Tour {completedCount}/{visibleSteps.length}</span>
        <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground/80 group-hover:text-foreground/70 transition-colors" />
      </motion.button>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="tour-panel"
        initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        drag dragMomentum={false} dragElastic={0.1}
        onDragEnd={(_, info) => setDragOffset((prev) => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))}
        style={{ x: dragOffset.x, y: dragOffset.y }}
        className="fixed bottom-6 left-[320px] z-[9999] w-[380px] max-w-[calc(100vw-2rem)]"
      >
        <div className={`rounded-2xl border ${colors.border} bg-background/95 backdrop-blur-xl shadow-2xl ${colors.glow} overflow-hidden`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/8 cursor-grab active:cursor-grabbing">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                <Sparkles className={`w-4 h-4 ${colors.text}`} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground/90 leading-tight">Guided Tour</h3>
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
      </motion.div>
    </AnimatePresence>
  );
}
