import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AdoptWizardStep } from '../useAdoptReducer';
import { ADOPT_STEP_META } from '../useAdoptReducer';

export interface WizardSidebarStep {
  key: AdoptWizardStep;
  label: string;
  Icon: LucideIcon;
}

export interface WizardSidebarProps {
  steps: WizardSidebarStep[];
  currentStep: AdoptWizardStep;
  completedSteps: Set<AdoptWizardStep>;
  onStepClick: (step: AdoptWizardStep) => void;
  disabled: boolean;
}

export function WizardSidebar({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
  disabled,
}: WizardSidebarProps) {
  return (
    <div className="w-[200px] border-r border-primary/10 bg-secondary/5 py-4">
      {steps.map((step, i) => {
        const stepIndex = ADOPT_STEP_META[step.key].index;
        const isActive = step.key === currentStep;
        const isCompleted = completedSteps.has(step.key);
        const isFuture = !isActive && !isCompleted;
        const isLast = i === steps.length - 1;

        return (
          <div key={step.key}>
            {/* Step row */}
            <button
              type="button"
              onClick={() => {
                if (!disabled && isCompleted) onStepClick(step.key);
              }}
              className={`
                relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors
                ${isActive ? 'border-l-2 border-violet-500 bg-violet-500/10' : 'border-l-2 border-transparent'}
                ${isCompleted && !disabled ? 'cursor-pointer hover:bg-secondary/30' : ''}
                ${isFuture || disabled ? 'cursor-default' : ''}
              `}
              disabled={disabled || isFuture}
            >
              {/* Node circle */}
              <div className="relative flex-shrink-0">
                <div
                  className={`
                    flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition-colors
                    ${isActive ? 'border-violet-500/50 bg-violet-500/15 text-violet-400' : ''}
                    ${isCompleted ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400' : ''}
                    ${isFuture ? 'border-primary/15 bg-secondary/20 text-muted-foreground/40' : ''}
                  `}
                >
                  {isCompleted ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <span>{stepIndex + 1}</span>
                  )}
                </div>

                {/* Pulsing ring for active step */}
                {isActive && (
                  <motion.div
                    className="absolute inset-0 rounded-full border border-violet-500/40"
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.5, 0, 0.5],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                )}
              </div>

              {/* Label */}
              <span
                className={`
                  text-sm font-medium transition-colors
                  ${isActive ? 'text-violet-300' : ''}
                  ${isCompleted ? 'text-foreground/80' : ''}
                  ${isFuture ? 'text-muted-foreground/40' : ''}
                `}
              >
                {step.label}
              </span>
            </button>

            {/* Connecting rail between steps */}
            {!isLast && (
              <div className="flex justify-center py-0">
                <div className="relative ml-[-56px]">
                  <div className="h-5 w-0.5 bg-primary/10" />
                  {/* Filled overlay for completed rail segments */}
                  <motion.div
                    className="absolute inset-0 w-0.5 bg-emerald-500/50"
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: isCompleted ? 1 : 0 }}
                    style={{ originY: 0 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 300 }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
