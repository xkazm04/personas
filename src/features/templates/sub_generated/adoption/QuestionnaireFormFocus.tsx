/**
 * Focus + Live Preview variant — "wildcard" variant exploring what happens
 * when the questionnaire shows the user, in real time, the shape of the
 * agent they're building.
 *
 * Layout: two columns.
 *   Left — one question at a time, large and prominent, with a bottom
 *          navigator showing question progress + quick-jump to any unanswered
 *          one. Only one decision on screen at a time so the user never
 *          feels overwhelmed.
 *   Right — a "persona brief" card that updates as answers come in. It
 *          summarises the agent's scope in plain English, mirroring the
 *          template's category structure:
 *            • Domain  — the specific resources being monitored
 *            • Config  — the triggers and thresholds
 *            • Quality — the expected shape of the output
 *            • Other   — anything that doesn't fit the above
 *          Answered values appear in full color, unanswered slots in a
 *          muted italic placeholder. The user sees the agent taking shape
 *          as they click through the pills.
 *
 * The key insight: on existing variants the user answers questions in a
 * vacuum. Here they can always see the effect of each answer on the final
 * agent's scope — which makes the whole questionnaire feel purposeful
 * rather than administrative.
 */
import { useMemo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleDot,
  AlertCircle,
  Zap,
} from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { useTranslation } from '@/i18n/useTranslation';
import { summarizeSourceDefinition } from '@/features/shared/components/forms/SourceDefinitionInput';
import type { DynamicOptionState } from './useDynamicQuestionOptions';
import {
  QuestionCard,
  CATEGORY_META,
  FALLBACK_CATEGORY,
} from './QuestionnaireFormGrid';

interface Props {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  autoDetectedIds?: Set<string>;
  blockedQuestionIds?: Set<string>;
  filteredOptions?: Record<string, string[]>;
  dynamicOptions?: Record<string, DynamicOptionState>;
  onRetryDynamic?: (questionId: string) => void;
  onAddCredential?: (vaultCategory: string) => void;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  templateName?: string;
}

function summarizeAnswer(
  raw: string,
  questionType?: TransformQuestionResponse['type'],
  t?: ReturnType<typeof useTranslation>['t'],
): string {
  if (!raw) return '';
  if (questionType === 'source_definition') {
    return summarizeSourceDefinition(raw, t);
  }
  if (raw === 'all') return t?.templates.adopt_modal.all_option ?? 'All';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? raw;
  if (parts.length === 2) return parts.join(' and ');
  return `${parts[0]}, ${parts[1]} +${parts.length - 2} more`;
}

export function QuestionnaireFormFocus({
  questions,
  userAnswers,
  autoDetectedIds,
  blockedQuestionIds,
  filteredOptions,
  dynamicOptions,
  onRetryDynamic,
  onAddCredential,
  onAnswerUpdated,
  onSubmit,
  templateName,
}: Props) {
  const { t, tx } = useTranslation();
  const [activeIdx, setActiveIdx] = useState(() => {
    // Start on the first unanswered + non-blocked question.
    const first = questions.findIndex(
      (q) => !userAnswers[q.id] && !blockedQuestionIds?.has(q.id),
    );
    return first >= 0 ? first : 0;
  });

  const currentQuestion = questions[activeIdx];
  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const blockedCount = blockedQuestionIds?.size ?? 0;
  const canSubmit = answeredCount === questions.length && blockedCount === 0;
  const isAtEnd = activeIdx === questions.length - 1;

  const next = useCallback(() => {
    setActiveIdx((i) => Math.min(i + 1, questions.length - 1));
  }, [questions.length]);
  const prev = useCallback(() => {
    setActiveIdx((i) => Math.max(i - 1, 0));
  }, []);

  // Keyboard nav.
  // - ArrowLeft / ArrowRight navigate between questions (ignored while typing
  //   so textareas can still use arrow keys for caret motion). Up/Down are
  //   reserved for in-widget pill navigation (handled inside SelectPills).
  // - Enter confirms the current answer and advances:
  //     * Last step + all answered → submit the whole form
  //     * Otherwise → advance one step (regardless of input type)
  //   Shift+Enter in a textarea still inserts a newline. Enter in an input
  //   of a non-text type (checkbox, radio) is left to the native control.
  const currentAnswered = !!userAnswers[currentQuestion?.id ?? ''];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isInput = tag === 'INPUT';
      const isTextarea = tag === 'TEXTAREA';
      const isTyping = isInput || isTextarea || target.isContentEditable;

      if (e.key === 'Enter') {
        // Shift+Enter in a textarea keeps the native newline insertion.
        if (isTextarea && e.shiftKey) return;
        // Non-text inputs (checkbox, radio, etc.) keep native Enter behaviour.
        if (isInput) {
          const inputType = (target as HTMLInputElement).type;
          if (inputType && inputType !== 'text' && inputType !== '' && inputType !== 'search') {
            return;
          }
        }
        // Last step + everything answered → submit.
        if (isAtEnd && canSubmit) {
          e.preventDefault();
          onSubmit();
          return;
        }
        // Otherwise, if the current question is answered, advance.
        if (currentAnswered) {
          e.preventDefault();
          next();
        }
        return;
      }
      if (isTyping) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, isAtEnd, canSubmit, onSubmit, currentAnswered]);

  // Build the preview structure from the template's category grouping.
  const categoryBuckets = useMemo(() => {
    const buckets: Record<string, TransformQuestionResponse[]> = {};
    for (const q of questions) {
      const key = q.category ?? '__other__';
      (buckets[key] ??= []).push(q);
    }
    return buckets;
  }, [questions]);

  if (!currentQuestion) return null;

  const currentMeta =
    CATEGORY_META[currentQuestion.category ?? ''] ?? FALLBACK_CATEGORY;
  const { Icon: CurrentIcon } = currentMeta;

  // Everything (header + stage + footer) is constrained to a single
  // `max-w-5xl` column so the left and right halves stay visually close on
  // ultra-wide screens. Without this the question and the live preview
  // could sit ~1500 px apart on a 1750-wide modal.
  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — progress + live counter */}
      <div className="flex-shrink-0 border-b border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-6 pt-5 pb-4">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-primary/80" />
              <h2 className="text-lg font-semibold text-foreground">
                {t.templates.adopt_modal.configure_your_persona}
              </h2>
            </div>
            <span className="text-foreground">·</span>
            <div className="flex items-center gap-3 text-sm text-foreground tabular-nums">
              <span>
                {tx(t.templates.adopt_modal.answered_of_total, {
                  answered: answeredCount,
                  total: questions.length,
                })}
              </span>
              {blockedCount > 0 && (
                <span className="text-rose-300/80 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {tx(t.templates.adopt_modal.blocked_count, { count: blockedCount })}
                </span>
              )}
            </div>
          </div>
          {/* Slim stepper strip — each question is a clickable dot.
              Centered so the row reads as a single control. */}
          <div className="flex items-center justify-center gap-1 mt-3">
            {questions.map((q, i) => {
              const isActive = i === activeIdx;
              const isAnswered = !!userAnswers[q.id];
              const isBlocked = blockedQuestionIds?.has(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  title={q.question}
                  className={`flex-shrink-0 h-1.5 rounded-full transition-all ${
                    isActive
                      ? 'w-10 bg-primary'
                      : isBlocked
                        ? 'w-3 bg-rose-500/60'
                        : isAnswered
                          ? 'w-5 bg-emerald-500/60 hover:bg-emerald-500'
                          : 'w-3 bg-white/[0.12] hover:bg-white/[0.2]'
                  }`}
                  aria-label={tx(t.templates.adopt_modal.question_number_aria, { number: i + 1 })}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Two-column stage, centered inside a max-w-5xl shell so the question
          and preview never drift too far apart on wide monitors. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-0 h-full">
          {/* LEFT — one question */}
          <div className="relative px-8 py-8 border-r border-white/[0.04]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentQuestion.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {/* Category crumb */}
                <div className="flex items-center gap-2 mb-4 text-xs uppercase tracking-wider">
                  <CurrentIcon className={`w-3.5 h-3.5 ${currentMeta.color}`} />
                  <span className={`font-semibold ${currentMeta.color}`}>
                    {currentMeta.label}
                  </span>
                  <span className="text-foreground">·</span>
                  <span className="text-foreground">
                    {tx(t.templates.adopt_modal.question_number_of, {
                      current: activeIdx + 1,
                      total: questions.length,
                    })}
                  </span>
                </div>
                {/* Big question card — reuses shared QuestionCard so dynamic-
                    source, auto-detect, and error flows all stay consistent. */}
                <QuestionCard
                  question={currentQuestion}
                  answer={userAnswers[currentQuestion.id] ?? ''}
                  onAnswer={(v) => onAnswerUpdated(currentQuestion.id, v)}
                  isAutoDetected={autoDetectedIds?.has(currentQuestion.id)}
                  isBlocked={blockedQuestionIds?.has(currentQuestion.id)}
                  onAddCredential={onAddCredential}
                  filteredOptions={filteredOptions?.[currentQuestion.id]}
                  dynamicState={dynamicOptions?.[currentQuestion.id]}
                  onRetryDynamic={onRetryDynamic}
                />

                {/* Hint + arrow-key legend. Enter is only wired on the last
                    step (to submit), so the hint is suppressed everywhere else
                    to avoid teaching a shortcut that won't work mid-flow. */}
                <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-foreground">
                  <kbd className="px-1.5 py-0.5 rounded border border-white/[0.1] bg-white/[0.03] font-mono text-[10px]">
                    ←
                  </kbd>
                  <kbd className="px-1.5 py-0.5 rounded border border-white/[0.1] bg-white/[0.03] font-mono text-[10px]">
                    →
                  </kbd>
                  <span>{t.templates.adopt_modal.navigate_hint}</span>
                  {isAtEnd && canSubmit && (
                    <>
                      <span className="text-foreground">·</span>
                      <kbd className="px-1.5 py-0.5 rounded border border-white/[0.1] bg-white/[0.03] font-mono text-[10px]">
                        Enter
                      </kbd>
                      <span>{t.templates.adopt_modal.enter_to_advance}</span>
                    </>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* RIGHT — live persona preview */}
          <div className="px-6 py-8 bg-white/[0.015]">
            <div className="sticky top-0">
            <div className="flex items-center gap-2 mb-4 text-xs uppercase tracking-wider text-primary/70">
              <Zap className="w-3.5 h-3.5" />
              <span className="font-semibold">{t.templates.adopt_modal.live_preview}</span>
            </div>
            <motion.div
              layout
              className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] to-transparent p-5"
            >
              <div className="text-xs uppercase tracking-wider text-foreground mb-1">
                {t.templates.adopt_modal.persona_label}
              </div>
              <div className="text-md font-semibold text-foreground leading-snug mb-4">
                {templateName ?? t.templates.adopt_modal.untitled_agent}
              </div>

              {Object.entries(categoryBuckets).map(([catKey, qs]) => {
                const meta = CATEGORY_META[catKey] ?? FALLBACK_CATEGORY;
                const { Icon } = meta;
                return (
                  <div key={catKey} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                      <span
                        className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="space-y-1 pl-4 border-l border-white/[0.06]">
                      {qs.map((q) => {
                        const answer = userAnswers[q.id];
                        const hasAnswer = !!answer;
                        const isAuto = autoDetectedIds?.has(q.id);
                        const isBlocked = blockedQuestionIds?.has(q.id);
                        const isCurrent = q.id === currentQuestion.id;
                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() =>
                              setActiveIdx(questions.findIndex((qq) => qq.id === q.id))
                            }
                            className={`flex items-start gap-2 w-full text-left rounded-input px-1.5 py-1 -mx-1.5 transition-colors ${
                              isCurrent ? 'bg-primary/10' : 'hover:bg-white/[0.03]'
                            }`}
                          >
                            {isBlocked ? (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
                            ) : hasAnswer ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                            ) : (
                              <CircleDot className="w-3.5 h-3.5 text-amber-400/60 mt-0.5 flex-shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs text-foreground truncate">
                                {q.question}
                              </div>
                              <div
                                className={`text-sm leading-tight truncate ${
                                  hasAnswer
                                    ? 'text-foreground/90 font-medium'
                                    : 'text-foreground italic'
                                }`}
                              >
                                {hasAnswer
                                  ? summarizeAnswer(answer, q.type, t)
                                  : t.templates.adopt_modal.not_yet_set}
                                {isAuto && hasAnswer && (
                                  <span className="ml-1.5 text-[10px] uppercase tracking-wider text-violet-400/80">
                                    {t.templates.adopt_modal.auto_badge}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </motion.div>
            {/* Helpful tip below the preview */}
            <p className="mt-4 typo-body text-foreground leading-relaxed">
              {t.templates.adopt_modal.jump_to_question_hint}
            </p>
          </div>
        </div>
        </div>
      </div>

      {/* Footer nav — centered in max-w-5xl shell to align with the stage */}
      <div className="flex-shrink-0 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={prev}
            disabled={activeIdx === 0}
            className="flex items-center gap-1.5 typo-body text-foreground hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {t.templates.adopt_modal.previous}
          </button>
          <div className="flex items-center gap-3">
            {isAtEnd && canSubmit ? (
              <button
                type="button"
                onClick={onSubmit}
                className="flex items-center gap-2 px-6 py-2 typo-body font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 shadow-elevation-3 shadow-primary/20 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                {t.templates.adopt_modal.submit_all}
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                disabled={isAtEnd}
                className="flex items-center gap-2 px-5 py-2 typo-body font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-elevation-3 shadow-primary/20 transition-all"
              >
                {t.templates.adopt_modal.next}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
