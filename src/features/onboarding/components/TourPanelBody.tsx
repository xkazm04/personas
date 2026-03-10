import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, Check, ArrowRight } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { TOUR_STEPS } from '@/stores/slices/system/tourSlice';
import type { TourStepId } from '@/stores/slices/system/tourSlice';
import { STEP_ICONS, STEP_COLORS } from './tourConstants';
import { StepProgress } from './StepProgress';

interface TourPanelBodyProps {
  currentIndex: number;
  completedSteps: Record<TourStepId, boolean>;
  isStepCompleted: boolean;
  allCompleted: boolean;
  onNext: () => void;
  onPrev: () => void;
  onJump: (index: number) => void;
}

export function TourPanelBody({
  currentIndex,
  completedSteps,
  isStepCompleted,
  allCompleted,
  onNext,
  onPrev,
  onJump,
}: TourPanelBodyProps) {
  const currentStep = TOUR_STEPS[currentIndex];
  if (!currentStep) return null;

  const colors = STEP_COLORS[currentStep.id];
  const StepIcon = STEP_ICONS[currentStep.id];

  return (
    <>
      {/* Step progress */}
      <div className="px-4 py-2.5 border-b border-primary/5">
        <StepProgress steps={TOUR_STEPS} currentIndex={currentIndex} completedSteps={completedSteps} onJump={onJump} />
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
          <p className="text-sm text-muted-foreground/70 leading-relaxed">{currentStep.description}</p>
          <div className={`rounded-xl ${colors.bg} border ${colors.border} p-3`}>
            <div className="flex items-start gap-2">
              <ArrowRight className={`w-3.5 h-3.5 ${colors.text} mt-0.5 flex-shrink-0`} />
              <p className={`text-sm ${colors.text} leading-relaxed font-medium`}>{currentStep.hint}</p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Footer navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-primary/8 bg-secondary/5">
        <button
          onClick={onPrev}
          disabled={currentIndex === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-primary/10 text-muted-foreground/50 hover:bg-secondary/50 hover:text-foreground/70 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <div className="flex items-center gap-2">
          {allCompleted ? (
            <button
              onClick={() => usePersonaStore.getState().finishTour()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Complete Tour
            </button>
          ) : (
            <button
              onClick={onNext}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl ${colors.bg} ${colors.text} border ${colors.border} hover:brightness-125 transition-all`}
            >
              {isStepCompleted ? 'Next' : 'Skip'}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
