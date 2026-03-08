import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Key,
  LayoutTemplate,
  Play,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  X,
  Check,
  MapPin,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { usePersonaStore } from "@/stores/personaStore";
import { TOUR_STEPS, type TourStepId } from "@/stores/slices/tourSlice";
import type { SidebarSection } from "@/lib/types/types";

// ── Step icon mapping ─────────────────────────────────────────────────

const STEP_ICONS: Record<TourStepId, typeof Key> = {
  "credentials-catalog": Key,
  "template-gallery": LayoutTemplate,
  "agent-execution": Play,
  "overview-messages": MessageSquare,
};

const STEP_COLORS: Record<TourStepId, { bg: string; border: string; text: string; glow: string }> = {
  "credentials-catalog": {
    bg: "bg-amber-500/10",
    border: "border-amber-500/25",
    text: "text-amber-400",
    glow: "shadow-amber-500/10",
  },
  "template-gallery": {
    bg: "bg-violet-500/10",
    border: "border-violet-500/25",
    text: "text-violet-400",
    glow: "shadow-violet-500/10",
  },
  "agent-execution": {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/10",
  },
  "overview-messages": {
    bg: "bg-blue-500/10",
    border: "border-blue-500/25",
    text: "text-blue-400",
    glow: "shadow-blue-500/10",
  },
};

// ── Progress dots ────────────────────────────────────────────────────

function StepProgress({
  steps,
  currentIndex,
  completedSteps,
  onJump,
}: {
  steps: typeof TOUR_STEPS;
  currentIndex: number;
  completedSteps: Record<TourStepId, boolean>;
  onJump: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, i) => {
        const isCompleted = completedSteps[step.id];
        const isCurrent = i === currentIndex;
        const Icon = STEP_ICONS[step.id];
        const colors = STEP_COLORS[step.id];

        return (
          <button
            key={step.id}
            onClick={() => onJump(i)}
            className={`relative flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200 ${
              isCurrent
                ? `${colors.bg} ${colors.border} border shadow-md ${colors.glow}`
                : isCompleted
                  ? "bg-emerald-500/10 border border-emerald-500/20"
                  : "bg-secondary/30 border border-primary/10 hover:bg-secondary/50"
            }`}
            title={step.title}
          >
            {isCompleted ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Icon className={`w-3 h-3 ${isCurrent ? colors.text : "text-muted-foreground/40"}`} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main GuidedTour component ────────────────────────────────────────

export default function GuidedTour() {
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

  const currentStep = TOUR_STEPS[currentIndex];
  const isStepCompleted = currentStep ? completedSteps[currentStep.id] : false;
  const allCompleted = TOUR_STEPS.every((s) => completedSteps[s.id]);
  const completedCount = TOUR_STEPS.filter((s) => completedSteps[s.id]).length;

  // Navigate to the correct app section when step changes
  const navigateToStep = useCallback(
    (stepIndex: number) => {
      const step = TOUR_STEPS[stepIndex];
      if (!step) return;

      setSidebarSection(step.nav.sidebarSection as SidebarSection);

      if (step.nav.subTab && step.nav.subTabSetter) {
        // Small delay to let sidebar section render first
        setTimeout(() => {
          if (step.nav.subTabSetter === "setOverviewTab") {
            setOverviewTab(step.nav.subTab as Parameters<typeof setOverviewTab>[0]);
          } else if (step.nav.subTabSetter === "setTemplateTab") {
            setTemplateTab(step.nav.subTab as Parameters<typeof setTemplateTab>[0]);
          }
        }, 100);
      }

      // Special handling for agent step: select the created persona
      if (step.id === "agent-execution" && tourCreatedPersonaId) {
        setTimeout(() => {
          selectPersona(tourCreatedPersonaId);
          setEditorTab("lab");
        }, 150);
      }
    },
    [setSidebarSection, setOverviewTab, setTemplateTab, selectPersona, setEditorTab, tourCreatedPersonaId],
  );

  // Navigate when step changes
  useEffect(() => {
    if (!tourActive || isMinimized) return;
    navigateToStep(currentIndex);
  }, [currentIndex, tourActive, navigateToStep, isMinimized]);

  // Auto-complete message step after viewing for 3s
  useEffect(() => {
    if (!tourActive || !currentStep || currentStep.id !== "overview-messages") return;
    const timer = setTimeout(() => {
      emitTourEvent("tour:messages-viewed");
    }, 3000);
    return () => clearTimeout(timer);
  }, [tourActive, currentStep, emitTourEvent]);

  // Auto-complete catalog step after viewing for 4s
  useEffect(() => {
    if (!tourActive || !currentStep || currentStep.id !== "credentials-catalog") return;
    const timer = setTimeout(() => {
      emitTourEvent("tour:catalog-explored");
    }, 4000);
    return () => clearTimeout(timer);
  }, [tourActive, currentStep, emitTourEvent]);

  const handleNext = () => {
    if (allCompleted) {
      usePersonaStore.getState().finishTour();
      return;
    }
    advanceTour();
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      usePersonaStore.setState({ tourCurrentStepIndex: prevIndex });
    }
  };

  const handleJump = (index: number) => {
    const step = TOUR_STEPS[index];
    if (step?.id === "template-gallery") {
      usePersonaStore.setState({ tourCurrentStepIndex: index, tourSearchPrefill: "AI Weekly Research" });
    } else {
      usePersonaStore.setState({ tourCurrentStepIndex: index });
    }
  };

  if (!tourActive || !currentStep) return null;

  const colors = STEP_COLORS[currentStep.id];
  const StepIcon = STEP_ICONS[currentStep.id];

  // Minimized floating pill
  if (isMinimized) {
    return (
      <motion.button
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        onClick={() => {
          setIsMinimized(false);
          navigateToStep(currentIndex);
        }}
        className={`fixed bottom-6 left-[320px] z-[9999] flex items-center gap-2 px-4 py-2.5 rounded-full
          bg-background/95 backdrop-blur-xl border ${colors.border} shadow-lg ${colors.glow}
          hover:shadow-xl transition-shadow cursor-pointer group`}
      >
        <MapPin className={`w-4 h-4 ${colors.text}`} />
        <span className="text-sm font-medium text-foreground/80">
          Tour {completedCount}/{TOUR_STEPS.length}
        </span>
        <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-foreground/70 transition-colors" />
      </motion.button>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="tour-panel"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        drag
        dragMomentum={false}
        dragElastic={0.1}
        onDragEnd={(_, info) =>
          setDragOffset((prev) => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))
        }
        style={{ x: dragOffset.x, y: dragOffset.y }}
        className="fixed bottom-6 left-[320px] z-[9999] w-[380px] max-w-[calc(100vw-2rem)]"
      >
        <div
          className={`rounded-2xl border ${colors.border} bg-background/95 backdrop-blur-xl shadow-2xl ${colors.glow} overflow-hidden`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/8 cursor-grab active:cursor-grabbing">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                <Sparkles className={`w-4 h-4 ${colors.text}`} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground/90 leading-tight">Guided Tour</h3>
                <p className="text-[11px] text-muted-foreground/50">
                  Step {currentIndex + 1} of {TOUR_STEPS.length}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(true)}
                className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/40 hover:text-foreground/70"
                title="Minimize"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={dismissTour}
                className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/40 hover:text-foreground/70"
                title="End tour"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Step progress */}
          <div className="px-4 py-2.5 border-b border-primary/5">
            <StepProgress
              steps={TOUR_STEPS}
              currentIndex={currentIndex}
              completedSteps={completedSteps}
              onJump={handleJump}
            />
          </div>

          {/* Step content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="px-4 py-4 space-y-3"
            >
              {/* Step title with icon */}
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center flex-shrink-0`}>
                  <StepIcon className={`w-4.5 h-4.5 ${colors.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                    {currentStep.title}
                    {isStepCompleted && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-medium text-emerald-400">
                        <Check className="w-2.5 h-2.5" />
                        Done
                      </span>
                    )}
                  </h4>
                </div>
              </div>

              {/* Description */}
              <p className="text-sm text-muted-foreground/70 leading-relaxed">
                {currentStep.description}
              </p>

              {/* Hint card */}
              <div className={`rounded-xl ${colors.bg} border ${colors.border} p-3`}>
                <div className="flex items-start gap-2">
                  <ArrowRight className={`w-3.5 h-3.5 ${colors.text} mt-0.5 flex-shrink-0`} />
                  <p className={`text-sm ${colors.text} leading-relaxed font-medium`}>
                    {currentStep.hint}
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Footer navigation */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-primary/8 bg-secondary/5">
            <button
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg
                border border-primary/10 text-muted-foreground/50
                hover:bg-secondary/50 hover:text-foreground/70 transition-all
                disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>

            <div className="flex items-center gap-2">
              {allCompleted ? (
                <button
                  onClick={() => usePersonaStore.getState().finishTour()}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl
                    bg-emerald-500/15 text-emerald-300 border border-emerald-500/25
                    hover:bg-emerald-500/25 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Complete Tour
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl
                    ${colors.bg} ${colors.text} border ${colors.border}
                    hover:brightness-125 transition-all`}
                >
                  {isStepCompleted ? "Next" : "Skip"}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
