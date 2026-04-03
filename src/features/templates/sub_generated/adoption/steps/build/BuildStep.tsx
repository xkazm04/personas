import { useMemo, useCallback, useState } from 'react';
import { Sparkles, AlertCircle, RefreshCw, Trash2, HelpCircle, Send, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TransformProgress } from '@/features/shared/components/progress/TransformProgress';
import { useAdoptionWizard } from '../../AdoptionWizardContext';
import { BORDER_SUBTLE, BORDER_DEFAULT, BORDER_EMPHASIS, CARD_PADDING } from '@/lib/utils/designTokens';

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
  questions: { id: string; question: string; type: 'select' | 'text' | 'textarea' | 'boolean' | 'devtools_project' | 'directory_picker'; options?: string[]; default?: string; context?: string; category?: string; allow_custom?: boolean }[];
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
        <h4 className="typo-heading text-foreground/80">Setup Questions</h4>
        <span className="typo-caption text-muted-foreground/50 tabular-nums ml-auto">{activeIndex + 1} / {questions.length}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => goTo(activeIndex - 1)}
          disabled={!canPrev}
          aria-label="Previous question"
          className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            canPrev ? `${BORDER_EMPHASIS} hover:bg-secondary/50 text-foreground/70` : `${BORDER_SUBTLE} text-foreground/15 cursor-default`
          }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
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
              className={`${CARD_PADDING.standard} rounded-xl border ${tone.border} ${tone.bg}`}
            >
              <p className="typo-body text-foreground/90 leading-relaxed mb-1">{q.question}</p>
              {q.context && <p className="typo-caption text-foreground/50 mb-3 leading-relaxed">{q.context}</p>}

              <div className="mt-2">
                {q.type === 'select' && q.options && (
                  <div className="space-y-1">
                    {q.options.map((opt) => {
                      const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                      return (
                        <button key={opt} type="button" onClick={() => onAnswerUpdated(q.id, opt)}
                          className={`w-full text-left px-3 py-1.5 typo-body rounded-lg border transition-all${
                            isSelected ? `${tone.selectBg} font-medium` : `text-foreground/70 ${BORDER_SUBTLE} hover:bg-secondary/40`
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
                    className={`w-full px-3 py-2 typo-body rounded-xl border${BORDER_DEFAULT} bg-background/60 text-foreground placeholder-muted-foreground/40 focus-ring transition-all`}
                  />
                )}
                {q.type === 'boolean' && (
                  <div className="flex gap-2">
                    {(q.options ?? ['Yes', 'No']).map((opt) => {
                      const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                      return (
                        <button key={opt} type="button" onClick={() => onAnswerUpdated(q.id, opt)}
                          className={`px-3 py-1.5 typo-body rounded-xl border transition-all${
                            isSelected ? `${tone.selectBg} font-medium` : `text-foreground/70 ${BORDER_SUBTLE} hover:bg-secondary/40`
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
          aria-label="Next question"
          className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            canNext ? `${BORDER_EMPHASIS} hover:bg-secondary/50 text-foreground/70` : `${BORDER_SUBTLE} text-foreground/15 cursor-default`
          }`}
        >
          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1">
        {questions.map((_, i) => {
          const isActive = i === activeIndex;
          const isAnswered = !!userAnswers[questions[i]!.id];
          return (
            <button key={i} type="button" onClick={() => goTo(i)}
              aria-label={`Go to question ${i + 1}`}
              className={`rounded-full transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
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
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl typo-body transition-all${
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

const DIMENSION_PROMPTS = [
  { key: 'use-cases', label: 'Core Behavior', hint: 'What the persona does — adjust scope, capabilities, or focus area', color: 'violet' },
  { key: 'connectors', label: 'Services', hint: 'Which external services to use — add, remove, or change integrations', color: 'blue' },
  { key: 'triggers', label: 'Triggers', hint: 'When and how it activates — schedules, webhooks, polling', color: 'cyan' },
  { key: 'human-review', label: 'Approval Policy', hint: 'What needs your approval before executing', color: 'amber' },
  { key: 'memory', label: 'Memory', hint: 'What to remember across runs — learning and persistence', color: 'emerald' },
  { key: 'error-handling', label: 'Error Handling', hint: 'How to handle failures, boundaries, and escalation', color: 'red' },
] as const;

function DimensionAdjustmentPanel({
  onSetAdjustment,
}: {
  onSetAdjustment: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dimensionNotes, setDimensionNotes] = useState<Record<string, string>>({});
  const [freeformText, setFreeformText] = useState('');

  // Build combined adjustment from dimension notes + freeform, keeping both in sync
  const buildCombined = useCallback((notes: Record<string, string>, freeform: string) => {
    const parts = Object.entries(notes)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => {
        const dim = DIMENSION_PROMPTS.find(d => d.key === k);
        return `[${dim?.label ?? k}]: ${v.trim()}`;
      });
    const dimensionBlock = parts.join('\n');
    const combined = [dimensionBlock, freeform].filter(Boolean).join('\n');
    onSetAdjustment(combined);
  }, [onSetAdjustment]);

  const handleDimensionNote = useCallback((key: string, value: string) => {
    setDimensionNotes(prev => {
      const next = { ...prev, [key]: value };
      buildCombined(next, freeformText);
      return next;
    });
  }, [buildCombined, freeformText]);

  const handleFreeformChange = useCallback((value: string) => {
    setFreeformText(value);
    buildCombined(dimensionNotes, value);
  }, [buildCombined, dimensionNotes]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Refine persona options"
        className="flex items-center gap-2 typo-body text-muted-foreground/70 hover:text-foreground/80 transition-colors"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" />
        Refine persona (optional)
      </button>

      {expanded && (
        <div className="space-y-2">
          <p className="typo-caption text-muted-foreground/50">
            Target specific dimensions to adjust, or use freeform below.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {DIMENSION_PROMPTS.map(dim => (
              <div key={dim.key} className={`rounded-lg border border-${dim.color}-500/10 bg-${dim.color}-500/[0.03] p-2.5`}>
                <label className="typo-caption font-medium text-foreground/70 block mb-1">
                  {dim.label}
                </label>
                <input
                  type="text"
                  value={dimensionNotes[dim.key] ?? ''}
                  onChange={e => handleDimensionNote(dim.key, e.target.value)}
                  placeholder={dim.hint}
                  className={`w-full px-2 py-1.5 typo-caption rounded-lg border${BORDER_SUBTLE} bg-background/40 text-foreground/75 placeholder-muted-foreground/30`}
                />
              </div>
            ))}
          </div>

          {/* Freeform fallback */}
          <textarea
            value={freeformText}
            onChange={e => handleFreeformChange(e.target.value)}
            placeholder="Or describe adjustments in your own words..."
            className={`w-full h-16 p-2.5 rounded-xl border ${BORDER_SUBTLE}bg-background/40 typo-caption text-foreground/75 resize-y placeholder-muted-foreground/30`}
          />
        </div>
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
        <h3 className="typo-body-lg font-semibold text-foreground">Build Persona</h3>
        <p className="typo-body text-muted-foreground/60 mt-0.5">
          Generating persona prompt, tools, triggers, and connectors based on your selections.
        </p>
      </div>

      {/* Progress */}
      {state.transforming && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10" aria-busy="true">
          <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin flex-shrink-0" aria-hidden="true" />
          <span className="typo-body text-violet-300/80" aria-live="polite">{phaseLabel}</span>
          {connectorCount > 0 && (
            <span className="typo-body text-muted-foreground/60 ml-auto">{connectorCount} connectors</span>
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
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20" aria-live="assertive" role="alert">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="typo-body text-red-400/80">{state.error}</p>
            <button
              type="button"
              onClick={() => void startTransform()}
              aria-label="Retry building persona"
              className="mt-1.5 typo-body text-red-300 hover:text-red-200 transition-colors underline underline-offset-2"
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
          <p className="typo-body text-blue-300/60 leading-relaxed">
            You can close this dialog -- processing continues in the background.
          </p>
        </div>
      )}

      {/* Dimension-targeted adjustment (post-build) */}
      {state.draft && !state.transforming && (
        <DimensionAdjustmentPanel
          onSetAdjustment={wizard.setAdjustment}
        />
      )}

      {/* Discard draft */}
      {!state.transforming && !state.confirming && (
        <button
          type="button"
          onClick={discardDraft}
          aria-label="Discard draft and start over"
          className="flex items-center gap-1.5 typo-body text-muted-foreground/40 hover:text-red-400/70 transition-colors"
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          Discard draft and start over
        </button>
      )}
    </div>
  );
}
