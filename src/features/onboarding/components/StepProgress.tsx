import { Check } from 'lucide-react';
import { TOUR_STEPS } from '@/stores/slices/system/tourSlice';
import type { TourStepId } from '@/stores/slices/system/tourSlice';
import { STEP_ICONS, STEP_COLORS } from './tourConstants';

interface StepProgressProps {
  steps: typeof TOUR_STEPS;
  currentIndex: number;
  completedSteps: Record<TourStepId, boolean>;
  onJump: (index: number) => void;
}

export function StepProgress({
  steps,
  currentIndex,
  completedSteps,
  onJump,
}: StepProgressProps) {
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
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'bg-secondary/30 border border-primary/10 hover:bg-secondary/50'
            }`}
            title={step.title}
          >
            {isCompleted ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Icon className={`w-3 h-3 ${isCurrent ? colors.text : 'text-muted-foreground/40'}`} />
            )}
          </button>
        );
      })}
    </div>
  );
}
