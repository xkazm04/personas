import { Check } from 'lucide-react';
import { WIZARD_STEPS } from './wizardSteps';

interface WizardStepIndicatorProps {
  stepIndex: number;
  onGoToStep: (index: number) => void;
}

export function WizardStepIndicator({ stepIndex, onGoToStep }: WizardStepIndicatorProps) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      {WIZARD_STEPS.map((step, i) => {
        const isActive = i === stepIndex;
        const isComplete = i < stepIndex;

        return (
          <div key={step.id} className="flex items-center gap-1.5">
            {i > 0 && (
              <div
                className={`w-6 h-px transition-colors ${
                  isComplete ? 'bg-violet-500/50' : 'bg-primary/10'
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => {
                if (i < stepIndex) onGoToStep(i);
              }}
              disabled={i > stepIndex}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-card text-sm transition-all ${
                isActive
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                  : isComplete
                  ? 'text-emerald-400/70 hover:bg-secondary/50 cursor-pointer'
                  : 'text-foreground cursor-default'
              }`}
            >
              {isComplete ? (
                <Check className="w-3 h-3" />
              ) : (
                <span className="w-4 text-center font-mono">{i + 1}</span>
              )}
              <span className="hidden sm:inline">{step.title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
