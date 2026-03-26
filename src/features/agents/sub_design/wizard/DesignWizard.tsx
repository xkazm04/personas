import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { WIZARD_STEPS, compileWizardInstruction, compileWizardToAgentIR, getAnswerSummary } from './wizardSteps';
import type { WizardAnswers } from './wizardSteps';
import type { AgentIR } from '@/lib/types/designTypes';
import { WizardStepRenderer } from './WizardStepRenderer';
import { WizardStepIndicator } from './WizardStepIndicator';

interface DesignWizardProps {
  onComplete: (instruction: string) => void;
  /** Called with a structured AgentIR compiled from wizard answers.
   *  When provided, enables direct-apply flows without LLM round-trip. */
  onCompleteIR?: (ir: AgentIR) => void;
  onCancel: () => void;
}

export function DesignWizard({ onComplete, onCompleteIR, onCancel }: DesignWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswers>({});
  const [additionalContext, setAdditionalContext] = useState('');
  const [_direction, setDirection] = useState(1); // 1 = forward, -1 = back

  const currentStep = WIZARD_STEPS[stepIndex]!;
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const isFirstStep = stepIndex === 0;

  // Check if current step has required answers
  const canProceed = useCallback(() => {
    if (isLastStep) return true;
    const step = WIZARD_STEPS[stepIndex]!;
    return step.questions.every((q) => {
      const answer = answers[q.id];
      if (q.multiSelect) {
        return Array.isArray(answer) && answer.length > 0;
      }
      return answer && typeof answer === 'string' && answer.length > 0;
    });
  }, [stepIndex, answers, isLastStep]);

  const handleAnswer = useCallback((questionId: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const handleNext = () => {
    if (isLastStep) {
      const allAnswers = { ...answers, additional_context: additionalContext };
      // Emit both the structured AgentIR and the string instruction.
      // Callers use whichever form fits their pipeline.
      if (onCompleteIR) {
        onCompleteIR(compileWizardToAgentIR(allAnswers));
      }
      const instruction = compileWizardInstruction(allAnswers);
      onComplete(instruction);
    } else {
      setDirection(1);
      setStepIndex((prev) => Math.min(prev + 1, WIZARD_STEPS.length - 1));
    }
  };

  const handleBack = () => {
    setDirection(-1);
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const summary = getAnswerSummary(answers);

  return (
    <div className="space-y-4">
      <WizardStepIndicator
        stepIndex={stepIndex}
        onGoToStep={(i) => { setDirection(-1); setStepIndex(i); }}
      />

      {/* Step content */}
      <div
          key={currentStep.id}
          className="animate-fade-slide-in rounded-xl border border-primary/10 bg-secondary/10 p-4"
        >
          {/* Step header */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-foreground/85">{currentStep.title}</h3>
            <p className="text-sm text-muted-foreground/90 mt-0.5">{currentStep.description}</p>
          </div>

          {/* Questions or review */}
          {isLastStep ? (
            <div className="space-y-4">
              {/* Summary cards */}
              {summary.length > 0 ? (
                <div className="grid gap-2">
                  {summary.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-start gap-3 px-3 py-2 rounded-xl bg-secondary/30 border border-primary/10"
                    >
                      <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80 w-24 flex-shrink-0 mt-0.5">
                        {item.label}
                      </span>
                      <span className="text-sm text-foreground/90">{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground/80 text-center py-4">
                  Go back and answer the questions to configure your agent.
                </p>
              )}

              {/* Additional context textarea */}
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground/90">
                  Additional instructions or context (optional)
                </label>
                <textarea
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder="Add any specific requirements, domain knowledge, or constraints..."
                  rows={4}
                  className="w-full bg-background/50 border border-primary/20 rounded-xl px-3 py-2 text-sm text-foreground resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/30 transition-all placeholder-muted-foreground/30"
                />
              </div>
            </div>
          ) : (
            <WizardStepRenderer
              step={currentStep}
              answers={answers}
              onAnswer={handleAnswer}
            />
          )}
        </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between">
        <div>
          {isFirstStep ? (
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors px-2 py-1"
            >
              Switch to manual
            </button>
          ) : (
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/50 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleNext}
          disabled={!canProceed()}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all ${
            isLastStep
              ? !canProceed() || summary.length === 0
                ? 'bg-secondary/60 text-muted-foreground/80 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
              : !canProceed()
              ? 'bg-secondary/60 text-muted-foreground/80 cursor-not-allowed'
              : 'bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25'
          }`}
        >
          {isLastStep ? (
            <>
              <Sparkles className="w-4 h-4" />
              Generate Design
            </>
          ) : (
            <>
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
