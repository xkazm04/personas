import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

export interface WizardStep {
  key: string;
  label: string;
}

interface WizardStepperProps {
  steps: WizardStep[];
  currentIndex: number;
}

const RAIL_SPRING = { damping: 18, stiffness: 300, type: 'spring' as const };

export function WizardStepper({ steps, currentIndex }: WizardStepperProps) {
  return (
    <div className="flex flex-col items-center gap-1" data-testid="wizard-stepper">
      <div className="flex items-center">
        {steps.map((step, i) => {
          const isCompleted = i < currentIndex;
          const isActive = i === currentIndex;

          return (
            <div key={step.key} className="flex items-center">
              {/* Rail connecting to previous node */}
              {i > 0 && (
                <div className="w-8 h-0.5 bg-primary/10 relative overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-emerald-500/50"
                    initial={{ width: '0%' }}
                    animate={{ width: isCompleted || isActive ? '100%' : '0%' }}
                    transition={RAIL_SPRING}
                  />
                </div>
              )}

              {/* Node */}
              <div className="relative flex items-center justify-center">
                {/* Pulse ring for active node */}
                {isActive && (
                  <motion.div
                    className="absolute inset-0 rounded-full bg-violet-500/20"
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <motion.div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors relative z-10 ${
                    isCompleted
                      ? 'bg-emerald-500/40 text-emerald-200'
                      : isActive
                        ? 'bg-violet-500/50 text-violet-200 shadow-[0_0_8px_rgba(139,92,246,0.3)]'
                        : 'bg-primary/10 text-muted-foreground/40'
                  }`}
                  data-testid={`wizard-step-node-${i}`}
                  layout
                  transition={RAIL_SPRING}
                >
                  {isCompleted ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </motion.div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Active step label below */}
      <span className="text-[11px] text-muted-foreground/70 font-medium">
        {steps[currentIndex]?.label}
      </span>
    </div>
  );
}
