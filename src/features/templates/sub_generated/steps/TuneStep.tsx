import { Sliders, Zap, Sparkles } from 'lucide-react';
import { TriggerConfigPanel } from '../review/TriggerConfigPanel';
import { ConfigureStep } from '@/features/shared/components/ConfigureStep';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { TransformQuestionResponse } from '@/api/n8nTransform';

interface TuneStepProps {
  designResult: DesignAnalysisResult | null;
  adoptionRequirements: Array<{
    key: string;
    label: string;
    description: string;
    required: boolean;
    type: string;
    options?: string[];
    default_value?: string;
  }>;
  variableValues: Record<string, string>;
  onUpdateVariable: (key: string, value: string) => void;
  selectedTriggerIndices: Set<number>;
  triggerConfigs: Record<number, Record<string, string>>;
  onTriggerConfigChange: (idx: number, config: Record<string, string>) => void;
  questions: TransformQuestionResponse[] | null;
  userAnswers: Record<string, string>;
  questionGenerating: boolean;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSkipQuestions: () => void;
}

export function TuneStep({
  designResult,
  adoptionRequirements,
  variableValues,
  onUpdateVariable,
  selectedTriggerIndices,
  triggerConfigs,
  onTriggerConfigChange,
  questions,
  userAnswers,
  questionGenerating,
  onAnswerUpdated,
  onSkipQuestions,
}: TuneStepProps) {
  const hasVariables = adoptionRequirements.length > 0;
  const hasTriggers = selectedTriggerIndices.size > 0 && (designResult?.suggested_triggers?.length ?? 0) > 0;
  const hasQuestions = questions !== null || questionGenerating;

  // Empty state
  if (!hasVariables && !hasTriggers && !hasQuestions) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Sparkles className="w-10 h-10 text-violet-400/30" />
        <p className="text-sm font-medium text-foreground/70">
          No additional configuration needed
        </p>
        <p className="text-xs text-muted-foreground/50">
          Proceed to build your persona
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Template Variables */}
      {hasVariables && (
        <div className="rounded-xl border border-primary/10 bg-secondary/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-4 h-4 text-muted-foreground/60" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Configuration
            </span>
          </div>

          <div className="space-y-4">
            {adoptionRequirements.map((variable) => {
              const value = variableValues[variable.key] ?? variable.default_value ?? '';
              const isEmpty = variable.required && !value.trim();

              return (
                <div key={variable.key} className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground/80">
                    {variable.label}
                    {variable.required && (
                      <span className="text-red-400 ml-0.5">*</span>
                    )}
                  </label>
                  {variable.description && (
                    <p className="text-xs text-muted-foreground/60">
                      {variable.description}
                    </p>
                  )}

                  {variable.type === 'select' && variable.options ? (
                    <select
                      value={value}
                      onChange={(e) => onUpdateVariable(variable.key, e.target.value)}
                      className={`w-full px-3 py-2 bg-background/50 border rounded-xl text-sm text-foreground/90 focus:outline-none focus:border-violet-500/30 transition-colors ${
                        isEmpty
                          ? 'border-red-500/30'
                          : 'border-primary/10'
                      }`}
                    >
                      <option value="">Select...</option>
                      {variable.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={variable.type === 'url' ? 'url' : 'text'}
                      value={value}
                      onChange={(e) => onUpdateVariable(variable.key, e.target.value)}
                      placeholder={variable.default_value ?? ''}
                      className={`w-full px-3 py-2 bg-background/50 border rounded-xl text-sm text-foreground/90 placeholder-muted-foreground/30 focus:outline-none focus:border-violet-500/30 transition-colors ${
                        isEmpty
                          ? 'border-red-500/30'
                          : 'border-primary/10'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trigger Configuration */}
      {hasTriggers && designResult?.suggested_triggers && (
        <div className="rounded-xl border border-primary/10 bg-secondary/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-muted-foreground/60" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Trigger Setup
            </span>
          </div>

          <TriggerConfigPanel
            triggers={designResult.suggested_triggers}
            selectedIndices={selectedTriggerIndices}
            configs={triggerConfigs}
            onConfigChange={onTriggerConfigChange}
          />
        </div>
      )}

      {/* AI Questions */}
      {hasQuestions && (
        <div className="rounded-xl border border-primary/10 bg-secondary/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-muted-foreground/60" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              AI Configuration
            </span>
          </div>

          <ConfigureStep
            questions={questions}
            userAnswers={userAnswers}
            questionGenerating={questionGenerating}
            onAnswerUpdated={onAnswerUpdated}
            onSkip={onSkipQuestions}
          />
        </div>
      )}
    </div>
  );
}
