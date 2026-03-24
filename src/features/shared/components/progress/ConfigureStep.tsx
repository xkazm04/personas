import { Loader2, Settings2, SkipForward } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

interface ConfigureStepProps {
  questions: TransformQuestionResponse[] | null;
  userAnswers: Record<string, string>;
  questionGenerating: boolean;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSkip: () => void;
  /** Loading text shown while questions are being generated */
  loadingText?: string;
}

export function ConfigureStep({
  questions,
  userAnswers,
  questionGenerating,
  onAnswerUpdated,
  onSkip,
  loadingText = 'Analyzing requirements...',
}: ConfigureStepProps) {
  if (questionGenerating) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="animate-fade-in"
        >
          <Loader2 className="w-8 h-8 text-violet-400/60" />
        </div>
        <p className="typo-body text-muted-foreground/80">{loadingText}</p>
        <button
          onClick={onSkip}
          className="flex items-center gap-2 typo-body text-muted-foreground/80 hover:text-muted-foreground transition-colors mt-2"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Skip configuration
        </button>
      </div>
    );
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Settings2 className="w-8 h-8 text-muted-foreground/80" />
        <p className="typo-body text-muted-foreground/90">No configuration questions needed.</p>
        <p className="typo-body text-muted-foreground/80">Click next to proceed with the transform.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="typo-heading text-foreground/80">Configure Transform</p>
          <p className="typo-body text-muted-foreground/90 mt-0.5">
            Answer these questions to customize the persona generation.
          </p>
        </div>
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 px-3 py-1.5 typo-body text-muted-foreground/80 hover:text-muted-foreground border border-primary/10 rounded-xl transition-colors"
        >
          <SkipForward className="w-3 h-3" />
          Skip
        </button>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div
            key={q.id}
            className="animate-fade-slide-in p-4 rounded-xl border border-primary/10 bg-secondary/10"
          >
            <label className="block typo-heading text-foreground/90 mb-2">
              {q.question}
            </label>

            {q.context && (
              <p className="typo-body text-muted-foreground/80 mb-2 leading-relaxed">
                {q.context}
              </p>
            )}

            {q.type === 'select' && q.options && (
              <ThemedSelect
                value={userAnswers[q.id] ?? q.default ?? ''}
                onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
              >
                <option value="">Select...</option>
                {q.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </ThemedSelect>
            )}

            {q.type === 'text' && (
              <input
                type="text"
                value={userAnswers[q.id] ?? q.default ?? ''}
                onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                placeholder={q.default ?? 'Type your answer...'}
                className="w-full px-3 py-2 typo-body rounded-xl border border-primary/15 bg-background/40 text-foreground/75 placeholder-muted-foreground/30"
              />
            )}

            {q.type === 'boolean' && (
              <div className="flex gap-3">
                {(q.options ?? ['Yes', 'No']).map((opt) => {
                  const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => onAnswerUpdated(q.id, opt)}
                      className={`px-4 py-1.5 typo-body rounded-xl border transition-colors ${
                        isSelected
                          ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
                          : 'text-muted-foreground/90 border-primary/10 hover:bg-secondary/30'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
