import { motion } from 'framer-motion';
import { Upload, Search, Sparkles, Pencil, Check } from 'lucide-react';
import { WIZARD_STEPS, STEP_META, type N8nWizardStep } from './useN8nImportReducer';

const STEP_ICONS: Record<N8nWizardStep, React.ComponentType<{ className?: string }>> = {
  upload: Upload,
  analyze: Search,
  transform: Sparkles,
  edit: Pencil,
  confirm: Check,
};

interface N8nStepIndicatorProps {
  currentStep: N8nWizardStep;
  className?: string;
}

export function N8nStepIndicator({ currentStep, className = '' }: N8nStepIndicatorProps) {
  const activeIndex = STEP_META[currentStep].index;

  return (
    <div className={`flex items-center gap-1 px-2 py-3 ${className}`}>
      {WIZARD_STEPS.map((step, i) => {
        const meta = STEP_META[step];
        const Icon = STEP_ICONS[step];
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;

        return (
          <div key={step} className="flex items-center gap-1 flex-1 last:flex-initial">
            <div className="flex items-center gap-2 min-w-0">
              {/* Step circle */}
              <div className="relative flex items-center justify-center">
                {isActive && (
                  <motion.div
                    className="absolute w-7 h-7 rounded-full bg-violet-500/20"
                    animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <motion.div
                  className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 ${
                    isActive
                      ? 'bg-violet-500/30 border border-violet-400/50'
                      : isCompleted
                        ? 'bg-emerald-500/20 border border-emerald-400/40'
                        : 'bg-secondary/40 border border-primary/10'
                  }`}
                  layout
                >
                  {isCompleted ? (
                    <Check className="w-3 h-3 text-emerald-400" strokeWidth={3} />
                  ) : (
                    <Icon
                      className={`w-3 h-3 ${
                        isActive ? 'text-violet-300' : 'text-muted-foreground/80'
                      }`}
                    />
                  )}
                </motion.div>
              </div>

              {/* Step label */}
              <span
                className={`text-sm font-medium truncate transition-colors duration-300 ${
                  isActive
                    ? 'text-violet-300'
                    : isCompleted
                      ? 'text-emerald-400/70'
                      : 'text-muted-foreground/80'
                }`}
              >
                {meta.label}
              </span>
            </div>

            {/* Connector line */}
            {i < WIZARD_STEPS.length - 1 && (
              <div className="flex-1 h-px mx-1.5 min-w-4">
                <div
                  className={`h-full rounded-full transition-colors duration-300 ${
                    i < activeIndex ? 'bg-emerald-400/40' : 'bg-secondary/25'
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
