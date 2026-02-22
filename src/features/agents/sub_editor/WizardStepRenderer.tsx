import { Check } from 'lucide-react';
import type { WizardStep, WizardAnswers } from './wizardSteps';

interface WizardStepRendererProps {
  step: WizardStep;
  answers: WizardAnswers;
  onAnswer: (questionId: string, value: string | string[]) => void;
}

export function WizardStepRenderer({ step, answers, onAnswer }: WizardStepRendererProps) {
  return (
    <div className="space-y-6">
      {step.questions.map((question) => {
        const currentValue = answers[question.id];

        return (
          <div key={question.id} className="space-y-3">
            <div>
              <span className="text-sm font-semibold uppercase tracking-wider text-violet-400/70">
                {question.header}
              </span>
              <p className="text-sm font-medium text-foreground/80 mt-0.5">
                {question.question}
              </p>
            </div>

            <div className="grid gap-2">
              {question.options.map((option) => {
                const isSelected = question.multiSelect
                  ? Array.isArray(currentValue) && currentValue.includes(option.label)
                  : currentValue === option.label;

                const handleClick = () => {
                  if (question.multiSelect) {
                    const current = Array.isArray(currentValue) ? currentValue : [];
                    const next = isSelected
                      ? current.filter((v) => v !== option.label)
                      : [...current, option.label];
                    onAnswer(question.id, next);
                  } else {
                    onAnswer(question.id, option.label);
                  }
                };

                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={handleClick}
                    className={`group relative flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-violet-500/40 bg-violet-500/10 shadow-sm shadow-violet-500/5'
                        : 'border-primary/10 bg-secondary/20 hover:border-primary/20 hover:bg-secondary/40'
                    }`}
                  >
                    {/* Indicator */}
                    <div
                      className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-${question.multiSelect ? 'md' : 'full'} border-2 flex items-center justify-center transition-all ${
                        isSelected
                          ? 'border-violet-500 bg-violet-500'
                          : 'border-primary/20 bg-transparent'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-sm font-medium block ${
                          isSelected ? 'text-foreground/90' : 'text-foreground/90'
                        }`}
                      >
                        {option.label}
                      </span>
                      <span className="text-sm text-muted-foreground/90 block mt-0.5 leading-relaxed">
                        {option.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
