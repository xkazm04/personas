import { motion } from 'framer-motion';
import { Loader2, Settings2, SkipForward } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/design';

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
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="w-8 h-8 text-violet-400/60" />
        </motion.div>
        <p className="text-sm text-muted-foreground/80">{loadingText}</p>
        <button
          onClick={onSkip}
          className="flex items-center gap-2 text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors mt-2"
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
        <p className="text-sm text-muted-foreground/90">No configuration questions needed.</p>
        <p className="text-sm text-muted-foreground/80">Click next to proceed with the transform.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground/80">Configure Transform</p>
          <p className="text-sm text-muted-foreground/90 mt-0.5">
            Answer these questions to customize the persona generation.
          </p>
        </div>
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-muted-foreground border border-primary/10 rounded-lg transition-colors"
        >
          <SkipForward className="w-3 h-3" />
          Skip
        </button>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="p-4 rounded-xl border border-primary/10 bg-secondary/10"
          >
            <label className="block text-sm font-medium text-foreground/90 mb-2">
              {q.question}
            </label>

            {q.context && (
              <p className="text-sm text-muted-foreground/80 mb-2 leading-relaxed">
                {q.context}
              </p>
            )}

            {q.type === 'select' && q.options && (
              <select
                value={userAnswers[q.id] ?? q.default ?? ''}
                onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-primary/15 bg-background/40 text-foreground/75"
              >
                <option value="">Select...</option>
                {q.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {q.type === 'text' && (
              <input
                type="text"
                value={userAnswers[q.id] ?? q.default ?? ''}
                onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                placeholder={q.default ?? 'Type your answer...'}
                className="w-full px-3 py-2 text-sm rounded-lg border border-primary/15 bg-background/40 text-foreground/75 placeholder-muted-foreground/30"
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
                      className={`px-4 py-1.5 text-sm rounded-lg border transition-colors ${
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
          </motion.div>
        ))}
      </div>
    </div>
  );
}
