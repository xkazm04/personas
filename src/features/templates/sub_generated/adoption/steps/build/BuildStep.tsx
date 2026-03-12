import { useMemo, useCallback, useState } from 'react';
import { Sparkles, AlertCircle, RefreshCw, Trash2, HelpCircle, Send, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TransformProgress } from '@/features/shared/components/progress/TransformProgress';
import { useAdoptionWizard } from '../../AdoptionWizardContext';

/** Parse transform lines to derive a user-friendly phase description. */
function derivePhaseLabel(lines: string[]): string {
  if (lines.length === 0) return 'Initializing...';
  const last = lines[lines.length - 1]?.toLowerCase() ?? '';
  if (last.includes('tool')) return 'Configuring tools...';
  if (last.includes('trigger')) return 'Setting up triggers...';
  if (last.includes('prompt') || last.includes('system')) return 'Building persona prompt...';
  if (last.includes('connector') || last.includes('service')) return 'Wiring connectors...';
  if (last.includes('validat')) return 'Validating draft...';
  if (last.includes('complet') || last.includes('done') || last.includes('finish')) return 'Finalizing...';
  return 'Generating persona...';
}

const CARD_TONES = [
  { border: 'border-violet-500/20', bg: 'bg-violet-500/[0.06]', accent: 'text-violet-500 dark:text-violet-300', selectBg: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/25' },
  { border: 'border-blue-500/20', bg: 'bg-blue-500/[0.06]', accent: 'text-blue-500 dark:text-blue-300', selectBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/25' },
  { border: 'border-cyan-500/20', bg: 'bg-cyan-500/[0.06]', accent: 'text-cyan-600 dark:text-cyan-300', selectBg: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/25' },
  { border: 'border-emerald-500/20', bg: 'bg-emerald-500/[0.06]', accent: 'text-emerald-600 dark:text-emerald-300', selectBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/25' },
  { border: 'border-amber-500/20', bg: 'bg-amber-500/[0.06]', accent: 'text-amber-600 dark:text-amber-300', selectBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/25' },
] as const;

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};

/** Inline questionnaire for the full wizard build step. */
function BuildQuestionnaire({
  questions,
  userAnswers,
  onAnswerUpdated,
  onSubmit,
}: {
  questions: { id: string; question: string; type: 'select' | 'text' | 'boolean'; options?: string[]; default?: string; context?: string; category?: string }[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < questions.length - 1;
  const isLast = activeIndex === questions.length - 1;

  const goTo = useCallback((index: number) => {
    setActiveIndex((prev) => {
      if (index < 0 || index >= questions.length || index === prev) return prev;
      setDirection(index > prev ? 1 : -1);
      return index;
    });
  }, [questions.length]);

  const q = questions[activeIndex]!;
  const tone = CARD_TONES[activeIndex % CARD_TONES.length]!;

  const allAnswered = questions.every((qn) => {
    const val = userAnswers[qn.id];
    return val !== undefined && val !== '';
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <HelpCircle className="w-4 h-4 text-primary flex-shrink-0" />
        <h4 className="text-sm font-semibold text-foreground/80">Setup Questions</h4>
        <span className="text-xs text-muted-foreground/50 tabular-nums ml-auto">{activeIndex + 1} / {questions.length}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => goTo(activeIndex - 1)}
          disabled={!canPrev}
          className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-all ${
            canPrev ? 'border-primary/20 hover:bg-secondary/50 text-foreground/70' : 'border-primary/5 text-foreground/15 cursor-default'
          }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={activeIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`p-3.5 rounded-xl border ${tone.border} ${tone.bg}`}
            >
              <p className="text-sm font-medium text-foreground/90 leading-relaxed mb-1">{q.question}</p>
              {q.context && <p className="text-xs text-foreground/50 mb-3 leading-relaxed">{q.context}</p>}

              <div className="mt-2">
                {q.type === 'select' && q.options && (
                  <div className="space-y-1">
                    {q.options.map((opt) => {
                      const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                      return (
                        <button key={opt} type="button" onClick={() => onAnswerUpdated(q.id, opt)}
                          className={`w-full text-left px-3 py-1.5 text-sm rounded-lg border transition-all ${
                            isSelected ? `${tone.selectBg} font-medium` : 'text-foreground/70 border-primary/10 hover:bg-secondary/40'
                          }`}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
                {q.type === 'text' && (
                  <input
                    type="text"
                    value={userAnswers[q.id] ?? q.default ?? ''}
                    onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                    placeholder={q.default ?? 'Type your answer...'}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-primary/15 bg-background/60 text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                )}
                {q.type === 'boolean' && (
                  <div className="flex gap-2">
                    {(q.options ?? ['Yes', 'No']).map((opt) => {
                      const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                      return (
                        <button key={opt} type="button" onClick={() => onAnswerUpdated(q.id, opt)}
                          className={`px-3 py-1.5 text-sm rounded-xl border transition-all ${
                            isSelected ? `${tone.selectBg} font-medium` : 'text-foreground/70 border-primary/10 hover:bg-secondary/40'
                          }`}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <button
          onClick={() => goTo(activeIndex + 1)}
          disabled={!canNext}
          className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-all ${
            canNext ? 'border-primary/20 hover:bg-secondary/50 text-foreground/70' : 'border-primary/5 text-foreground/15 cursor-default'
          }`}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1">
        {questions.map((_, i) => {
          const isActive = i === activeIndex;
          const isAnswered = !!userAnswers[questions[i]!.id];
          return (
            <button key={i} type="button" onClick={() => goTo(i)}
              className={`rounded-full transition-all duration-200 ${
                isActive ? 'w-5 h-1.5 bg-primary' : isAnswered ? 'w-1.5 h-1.5 bg-primary/50' : 'w-1.5 h-1.5 bg-foreground/15'
              }`}
            />
          );
        })}
      </div>

      {/* Submit */}
      {isLast && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!allAnswered}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
            allAnswered
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-primary/30 text-primary-foreground/50 cursor-not-allowed'
          }`}
        >
          Submit Answers <Send className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function BuildStep() {
  const {
    state,
    wizard,
    currentAdoptId,
    isRestoring,
    startTransform,
    cancelTransform,
    continueTransform,
    discardDraft,
    requiredConnectors,
  } = useAdoptionWizard();

  const phaseLabel = useMemo(
    () => derivePhaseLabel(state.transformLines),
    [state.transformLines],
  );

  const connectorCount = requiredConnectors.length;
  const hasQuestions = !!state.questions && state.questions.length > 0 && !state.transforming;

  const handleAnswerUpdated = useCallback((questionId: string, answer: string) => {
    wizard.answerUpdated(questionId, answer);
  }, [wizard]);

  const handleSubmitAnswers = useCallback(() => {
    void continueTransform();
  }, [continueTransform]);

  return (
    <div className="space-y-3">
      {/* Step header */}
      <div>
        <h3 className="text-base font-semibold text-foreground">Build Persona</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          Generating persona prompt, tools, triggers, and connectors based on your selections.
        </p>
      </div>

      {/* Progress */}
      {state.transforming && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin flex-shrink-0" />
          <span className="text-sm text-violet-300/80">{phaseLabel}</span>
          {connectorCount > 0 && (
            <span className="text-sm text-muted-foreground/60 ml-auto">{connectorCount} connectors</span>
          )}
        </div>
      )}

      <TransformProgress
        phase={state.transformPhase}
        lines={state.transformLines}
        runId={currentAdoptId}
        isRestoring={isRestoring}
        onRetry={() => void startTransform()}
        onCancel={() => void cancelTransform()}
      />

      {/* Questionnaire -- shown when CLI asks questions */}
      {hasQuestions && (
        <BuildQuestionnaire
          questions={state.questions!}
          userAnswers={state.userAnswers}
          onAnswerUpdated={handleAnswerUpdated}
          onSubmit={handleSubmitAnswers}
        />
      )}

      {/* Inline error display */}
      {state.error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-400/80">{state.error}</p>
            <button
              type="button"
              onClick={() => void startTransform()}
              className="mt-1.5 text-sm text-red-300 hover:text-red-200 transition-colors underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Background hint */}
      {state.transforming && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-blue-500/5 border border-blue-500/10">
          <Sparkles className="w-4 h-4 text-blue-400/60 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-300/60 leading-relaxed">
            You can close this dialog -- processing continues in the background.
          </p>
        </div>
      )}

      {/* Adjustment request (post-build) */}
      {state.draft && !state.transforming && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground/70">
            Request adjustments (optional)
          </label>
          <textarea
            value={state.adjustmentRequest}
            onChange={(e) => wizard.setAdjustment(e.target.value)}
            placeholder="Example: Change the schedule to run at 9 AM, remove ClickUp integration, add Slack notifications"
            className="w-full h-20 p-3 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground/75 resize-y placeholder-muted-foreground/30"
          />
        </div>
      )}

      {/* Discard draft */}
      {!state.transforming && !state.confirming && (
        <button
          type="button"
          onClick={discardDraft}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/40 hover:text-red-400/70 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Discard draft and start over
        </button>
      )}
    </div>
  );
}
