import { Check } from 'lucide-react';
import type { TourStepDef, TourStepId } from '@/stores/slices/system/tourSlice';
import { getStepColors } from './tourConstants';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { PressSurface } from '@/features/shared/components/buttons';
interface StepProgressProps {
  steps: TourStepDef[];
  currentIndex: number;
  completedSteps: Record<TourStepId, boolean>;
  onJump: (index: number) => void;
  /**
   * Active sub-step index of the current step. When provided, the current row
   * shows a live `done/total` sub-step indicator so multi-part steps reveal
   * their internal progress in the list. Omit (resume interstitial) to hide it.
   */
  subStepIndex?: number;
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
  subStepIndex,
}: StepProgressProps) {
  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const isCompleted = completedSteps[step.id];
        const isCurrent = i === currentIndex;
        const colors = getStepColors(step.id);
        const showSubProgress =
          isCurrent && !isCompleted && subStepIndex != null && step.subSteps.length > 0;

        return (
          <Tooltip content={step.title}><PressSurface key={step.id} onPress={() => onJump(i)} data-testid={`tour-step-${step.id}`} className={`group flex items-center gap-2.5 px-1 py-1.5 rounded-card ${i > 0 ? 'border-t border-hair' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
            <span
              className={`flex items-center justify-center w-5 h-5 rounded-full typo-caption flex-shrink-0 border ${
                isCompleted
                  ? 'bg-status-success/15 border-status-success/30 text-status-success'
                  : isCurrent
                    ? `${colors.subtle} ${colors.accent} ${colors.text}`
                    : 'bg-surface-1 border-hair text-ink-1'
              }`}
            >
              {isCompleted ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span
              className={`typo-caption truncate ${
                isCurrent
                  ? `${colors.text}`
                  : isCompleted
                    ? 'text-ink-1'
                    : 'text-ink-1'
              }`}
            >
              {step.title}
            </span>
            {showSubProgress && (
              <span className={`ml-auto pl-1.5 flex-shrink-0 typo-caption tabular-nums ${colors.text}`}>
                {subStepIndex}/{step.subSteps.length}
              </span>
            )}
          </PressSurface></Tooltip>
        );
      })}
    </div>
  );
}
