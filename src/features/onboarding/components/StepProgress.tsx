import { Check } from 'lucide-react';
import type { TourStepDef, TourStepId } from '@/stores/slices/system/tourSlice';
import { getStepColors } from './tourConstants';

interface StepProgressProps {
  steps: TourStepDef[];
  currentIndex: number;
  completedSteps: Record<TourStepId, boolean>;
  onJump: (index: number) => void;
}

/**
 * Vertical step list for the tour panel. Each step is represented by its
 * NUMBER + NAME (not an icon), with a thin divider between rows for a
 * space-efficient table-of-contents feel. The current step is accent-colored;
 * completed steps show a check.
 */
export function StepProgress({
  steps,
  currentIndex,
  completedSteps,
  onJump,
}: StepProgressProps) {
  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const isCompleted = completedSteps[step.id];
        const isCurrent = i === currentIndex;
        const colors = getStepColors(step.id);

        return (
          <button
            key={step.id}
            onClick={() => onJump(i)}
            data-testid={`tour-step-${step.id}`}
            className={`group flex items-center gap-2.5 px-1 py-1.5 text-left rounded-card transition-colors ${
              i > 0 ? 'border-t border-primary/5' : ''
            } ${isCurrent ? '' : 'hover:bg-secondary/20'}`}
            aria-current={isCurrent ? 'step' : undefined}
            title={step.title}
          >
            <span
              className={`flex items-center justify-center w-5 h-5 rounded-full typo-caption font-semibold flex-shrink-0 border ${
                isCompleted
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : isCurrent
                    ? `${colors.subtle} ${colors.accent} ${colors.text}`
                    : 'bg-secondary/30 border-primary/10 text-foreground'
              }`}
            >
              {isCompleted ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span
              className={`typo-caption truncate ${
                isCurrent
                  ? `${colors.text} font-semibold`
                  : isCompleted
                    ? 'text-foreground/80'
                    : 'text-foreground'
              }`}
            >
              {step.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
