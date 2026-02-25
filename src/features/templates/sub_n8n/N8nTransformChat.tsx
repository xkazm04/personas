import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle2, ChevronDown, KeyRound, Settings2, ShieldCheck, Brain, Bell } from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { TransformQuestion, TransformSubPhase } from './useN8nImportReducer';
import { TransformProgress } from '@/features/shared/components/TransformProgress';

// Dimension category labels and icons
const DIMENSION_LABELS: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  credentials:       { label: 'Credentials',       Icon: KeyRound },
  configuration:     { label: 'Configuration',     Icon: Settings2 },
  human_in_the_loop: { label: 'Human in the Loop', Icon: ShieldCheck },
  memory:            { label: 'Memory & Learning',  Icon: Brain },
  notifications:     { label: 'Notifications',      Icon: Bell },
};

// Theme subtone colors cycled across questions
const QUESTION_TONES = [
  { border: 'border-violet-500/15', bg: 'bg-violet-500/[0.04]', accent: 'text-violet-400', selectBg: 'bg-violet-500/15 text-violet-300 border-violet-500/25' },
  { border: 'border-blue-500/15', bg: 'bg-blue-500/[0.04]', accent: 'text-blue-400', selectBg: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  { border: 'border-cyan-500/15', bg: 'bg-cyan-500/[0.04]', accent: 'text-cyan-400', selectBg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25' },
  { border: 'border-emerald-500/15', bg: 'bg-emerald-500/[0.04]', accent: 'text-emerald-400', selectBg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
  { border: 'border-amber-500/15', bg: 'bg-amber-500/[0.04]', accent: 'text-amber-400', selectBg: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
  { border: 'border-rose-500/15', bg: 'bg-rose-500/[0.04]', accent: 'text-rose-400', selectBg: 'bg-rose-500/15 text-rose-300 border-rose-500/25' },
] as const;

interface N8nTransformChatProps {
  transformSubPhase: TransformSubPhase;
  questions: TransformQuestion[] | null;
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  transformPhase: CliRunPhase;
  transformLines: string[];
  runId: string | null;
  isRestoring: boolean;
  onRetry: () => void;
  onCancel: () => void;
}

export function N8nTransformChat({
  transformSubPhase,
  questions,
  userAnswers,
  onAnswerUpdated,
  transformPhase,
  transformLines,
  runId,
  isRestoring,
  onRetry,
  onCancel,
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
      {/* Phase 1: Asking — unified transform in progress */}
      {transformSubPhase === 'asking' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <TransformProgress
            phase={transformPhase}
            lines={transformLines}
            runId={runId}
            isRestoring={isRestoring}
            onRetry={onRetry}
            onCancel={onCancel}
          />
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
              className="rounded-xl border border-primary/10 bg-secondary/20 p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground/85">
                      A few questions to customize your persona
                    </p>
                    <p className="text-sm text-muted-foreground/80 mt-0.5">
                      Answer below, then click Generate
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {questions.map((q, i) => {
                  const tone = QUESTION_TONES[i % QUESTION_TONES.length]!;
                  const prevCategory = i > 0 ? questions[i - 1]!.category : undefined;
                  const showSeparator = q.category && q.category !== prevCategory;
                  const dim = q.category ? DIMENSION_LABELS[q.category] : undefined;

                  return (
                    <div key={q.id}>
                      {/* Category dimension separator */}
                      {showSeparator && dim && (
                        <div className="flex items-center gap-2 pt-3 pb-1">
                          <dim.Icon className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold whitespace-nowrap">
                            {dim.label}
                          </span>
                          <hr className="flex-1 border-primary/8" />
                        </div>
                      )}

                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className={`p-4 rounded-xl border ${tone.border} ${tone.bg}`}
                      >
                        <label className={`block text-sm font-medium mb-2 ${tone.accent}`}>
                          {q.question}
                        </label>

                        {q.context && (
                          <p className="text-sm text-muted-foreground/70 mb-2 leading-relaxed">
                            {q.context}
                          </p>
                        )}

                        {q.type === 'select' && q.options && (
                          <div className="relative">
                            <select
                              value={userAnswers[q.id] ?? q.default ?? ''}
                              onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                              className="w-full px-3 py-2 text-sm rounded-lg border border-primary/15 bg-background/80 text-foreground/85 appearance-none cursor-pointer focus:outline-none focus:border-primary/30 transition-colors [&>option]:bg-[#14141f] [&>option]:text-foreground/85"
                            >
                              <option value="">Select...</option>
                              {q.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/80 pointer-events-none" />
                          </div>
                        )}

                        {q.type === 'text' && (
                          <input
                            type="text"
                            value={userAnswers[q.id] ?? q.default ?? ''}
                            onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                            placeholder={q.default ?? 'Type your answer...'}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-primary/15 bg-background/80 text-foreground/85 placeholder-muted-foreground/30 focus:outline-none focus:border-primary/30 transition-colors"
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
                                      ? tone.selectBg
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
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* No questions */}
          {(!questions || questions.length === 0) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-primary/10 bg-secondary/20 p-5"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-secondary/40 border border-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
                </div>
                <div>
                  <p className="text-sm text-foreground/90">
                    No configuration needed
                  </p>
                  <p className="text-sm text-muted-foreground/80 mt-0.5">
                    Click Generate to create your persona draft with defaults.
                  </p>
                </div>
              </div>
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
              className="rounded-xl border border-primary/10 bg-secondary/20 p-4"
            >
              <p className="text-sm font-medium text-muted-foreground/90 uppercase tracking-wider mb-2">
                Your answers
              </p>
              <div className="flex flex-wrap gap-1.5">
                {questions.map((q) => {
                  const answer = userAnswers[q.id];
                  if (!answer) return null;
                  return (
                    <span
                      key={q.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-md bg-violet-500/10 text-violet-300/80 border border-violet-500/15"
                    >
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      {answer.length > 30 ? `${answer.slice(0, 30)}...` : answer}
                    </span>
                  );
                })}
              </div>
            </motion.div>
          )}

          <TransformProgress
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
        <TransformProgress
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
        <TransformProgress
          phase="idle"
          lines={[]}
          runId={null}
          isRestoring={false}
        />
      )}
    </div>
  );
}
