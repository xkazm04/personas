import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/useMotion';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AdoptWizardStep } from '../useAdoptReducer';
import { ADOPT_STEP_META } from '../useAdoptReducer';

export interface WizardSidebarStep {
  key: AdoptWizardStep;
  label: string;
  Icon: LucideIcon;
}

/** One-line descriptions for each step shown as subtitle */
const STEP_DESCRIPTIONS: Record<AdoptWizardStep, string> = {
  choose: 'Pick capabilities',
  connect: 'Link credentials',
  tune: 'Set preferences',
  build: 'Generate persona',
  create: 'Review & save',
};

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
  const { shouldAnimate, spring } = useMotion();

  return (
    <div className="w-[180px] border-r border-primary/10 bg-secondary/5 py-3 flex-shrink-0" role="navigation" aria-label="Wizard steps">
      {steps.map((step, i) => {
        const stepIndex = ADOPT_STEP_META[step.key].index;
        const isActive = step.key === currentStep;
        const isCompleted = completedSteps.has(step.key);
        const isFuture = !isActive && !isCompleted;
        const isLast = i === steps.length - 1;

        return (
          <div key={step.key}>
            <button
              type="button"
              onClick={() => {
                if (!disabled && isCompleted) onStepClick(step.key);
              }}
              title={STEP_DESCRIPTIONS[step.key]}
              className={`
                relative flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors
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
                    flex h-6 w-6 items-center justify-center rounded-full border text-sm font-medium transition-colors
                    ${isActive ? 'border-violet-500/50 bg-violet-500/15 text-violet-400' : ''}
                    ${isCompleted ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400' : ''}
                    ${isFuture ? 'border-primary/15 bg-secondary/20 text-muted-foreground/40' : ''}
                  `}
                >
                  {isCompleted ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <span className="text-[11px]">{stepIndex + 1}</span>
                  )}
                </div>

                {isActive && shouldAnimate && (
                  <motion.div
                    className="absolute inset-0 rounded-full border border-violet-500/40"
                    animate={{
                      scale: [1, 1.4, 1],
                      opacity: [0.4, 0, 0.4],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                )}
              </div>

              {/* Label + description */}
              <div className="min-w-0">
                <span
                  className={`
                    text-sm font-medium block transition-colors
                    ${isActive ? 'text-violet-300' : ''}
                    ${isCompleted ? 'text-foreground/80' : ''}
                    ${isFuture ? 'text-muted-foreground/40' : ''}
                  `}
                >
                  {step.label}
                </span>
                <span className={`text-[10px] block ${
                  isActive ? 'text-violet-400/50' : 'text-muted-foreground/30'
                }`}>
                  {STEP_DESCRIPTIONS[step.key]}
                </span>
              </div>
            </button>

            {/* Connecting rail */}
            {!isLast && (
              <div className="flex justify-center py-0">
                <div className="relative ml-[-48px]">
                  <div className="h-3 w-0.5 bg-primary/10" />
                  <motion.div
                    className="absolute inset-0 w-0.5 bg-emerald-500/50"
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: isCompleted ? 1 : 0 }}
                    style={{ originY: 0 }}
                    transition={spring}
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
