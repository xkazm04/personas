import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, SkipForward, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { TransformQuestion, TransformSubPhase } from './useN8nImportReducer';
import { N8nTransformProgress } from './N8nTransformProgress';

interface N8nTransformChatProps {
  transformSubPhase: TransformSubPhase;
  questions: TransformQuestion[] | null;
  questionsSkipped: boolean;
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSkipQuestions: () => void;
  transformPhase: CliRunPhase;
  transformLines: string[];
  runId: string | null;
  isRestoring: boolean;
  onRetry: () => void;
  onCancel: () => void;
  error: string | null;
}

export function N8nTransformChat({
  transformSubPhase,
  questions,
  questionsSkipped,
  userAnswers,
  onAnswerUpdated,
  onSkipQuestions,
  transformPhase,
  transformLines,
  runId,
  isRestoring,
  onRetry,
  onCancel,
  error,
}: N8nTransformChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on phase transitions
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [transformSubPhase]);

  return (
    <div ref={scrollRef} className="space-y-4">
      {/* Phase 1: Asking — question generation in progress */}
      {transformSubPhase === 'asking' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-5"
        >
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <motion.div
                className="absolute inset-0 w-8 h-8 rounded-lg bg-violet-500/20"
                animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-violet-400" />
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground/70">Analyzing workflow requirements...</p>
              <p className="text-xs text-muted-foreground/40 mt-0.5">Preparing customization questions</p>
            </div>
          </div>

          <button
            onClick={onSkipQuestions}
            className="mt-4 flex items-center gap-2 text-xs text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip to generation
          </button>
        </motion.div>
      )}

      {/* Phase 2: Answering — questions loaded, user fills in */}
      {transformSubPhase === 'answering' && (
        <AnimatePresence>
          {/* Questions available */}
          {questions && questions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground/70">
                      A few questions to customize your persona
                    </p>
                    <p className="text-xs text-muted-foreground/40 mt-0.5">
                      Answer below, then click Generate
                    </p>
                  </div>
                </div>
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
                    <label className="block text-xs font-medium text-foreground/70 mb-2">
                      {q.question}
                    </label>

                    {q.context && (
                      <p className="text-[10px] text-muted-foreground/40 mb-2 leading-relaxed">
                        {q.context}
                      </p>
                    )}

                    {q.type === 'select' && q.options && (
                      <select
                        value={userAnswers[q.id] ?? q.default ?? ''}
                        onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-primary/15 bg-background/40 text-foreground/75"
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
                        className="w-full px-3 py-2 text-xs rounded-lg border border-primary/15 bg-background/40 text-foreground/75 placeholder-muted-foreground/30"
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
                              className={`px-4 py-1.5 text-xs rounded-lg border transition-colors ${
                                isSelected
                                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
                                  : 'text-muted-foreground/50 border-primary/10 hover:bg-secondary/30'
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
            </motion.div>
          )}

          {/* Skipped or no questions */}
          {(!questions || questions.length === 0) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-primary/10 bg-secondary/10 p-5"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-secondary/40 border border-primary/10 flex items-center justify-center">
                  {questionsSkipped ? (
                    <SkipForward className="w-4 h-4 text-muted-foreground/50" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-foreground/60">
                    {questionsSkipped
                      ? 'Configuration skipped'
                      : 'No configuration needed'}
                  </p>
                  <p className="text-xs text-muted-foreground/40 mt-0.5">
                    Click Generate to create your persona draft with defaults.
                  </p>
                </div>
              </div>

              {/* Show inline error if question generation failed */}
              {error && questionsSkipped && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-amber-400/70 leading-relaxed">
                    {error}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Phase 3: Generating — show answer summary + transform progress */}
      {transformSubPhase === 'generating' && (
        <>
          {/* Answer summary bubble */}
          {Object.keys(userAnswers).length > 0 && questions && questions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-primary/10 bg-secondary/10 p-4"
            >
              <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-2">
                Your answers
              </p>
              <div className="flex flex-wrap gap-1.5">
                {questions.map((q) => {
                  const answer = userAnswers[q.id];
                  if (!answer) return null;
                  return (
                    <span
                      key={q.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-violet-500/10 text-violet-300/80 border border-violet-500/15"
                    >
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      {answer.length > 30 ? `${answer.slice(0, 30)}...` : answer}
                    </span>
                  );
                })}
              </div>
            </motion.div>
          )}

          <N8nTransformProgress
            phase={transformPhase}
            lines={transformLines}
            runId={runId}
            isRestoring={isRestoring}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </>
      )}

      {/* Phase 4: Failed — show progress (which renders failure state) */}
      {transformSubPhase === 'failed' && (
        <N8nTransformProgress
          phase={transformPhase}
          lines={transformLines}
          runId={runId}
          isRestoring={false}
          onRetry={onRetry}
          onCancel={onCancel}
        />
      )}

      {/* Idle state — shouldn't normally be visible, but handle gracefully */}
      {transformSubPhase === 'idle' && (
        <N8nTransformProgress
          phase="idle"
          lines={[]}
          runId={null}
          isRestoring={false}
        />
      )}
    </div>
  );
}
