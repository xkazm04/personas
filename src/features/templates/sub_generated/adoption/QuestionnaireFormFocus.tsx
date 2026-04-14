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

function summarizeAnswer(raw: string): string {
  if (!raw) return '';
  if (raw === 'all') return 'All';
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
  const { t } = useTranslation();
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

  const next = useCallback(() => {
    setActiveIdx((i) => Math.min(i + 1, questions.length - 1));
  }, [questions.length]);
  const prev = useCallback(() => {
    setActiveIdx((i) => Math.max(i - 1, 0));
  }, []);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isTyping) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

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
  const isAtEnd = activeIdx === questions.length - 1;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — progress + live counter */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-primary/80" />
            <h2 className="text-lg font-semibold text-foreground">
              {t.templates.adopt_modal.configure_your_persona}
            </h2>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground/60 tabular-nums">
            <span>
              {answeredCount} / {questions.length} answered
            </span>
            {blockedCount > 0 && (
              <span className="text-rose-300/80 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {blockedCount} blocked
              </span>
            )}
          </div>
        </div>
        {/* Slim stepper strip — each question is a clickable dot. */}
        <div className="flex items-center gap-1 mt-3 overflow-x-auto">
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
                aria-label={`Question ${i + 1}`}
              />
            );
          })}
        </div>
      </div>

      {/* Two-column stage */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-0">
        {/* LEFT — one question */}
        <div className="relative overflow-y-auto px-8 py-8 border-r border-white/[0.04]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentQuestion.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="max-w-xl"
            >
              {/* Category crumb */}
              <div className="flex items-center gap-2 mb-4 text-xs uppercase tracking-wider">
                <CurrentIcon className={`w-3.5 h-3.5 ${currentMeta.color}`} />
                <span className={`font-semibold ${currentMeta.color}`}>
                  {currentMeta.label}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground/60">
                  Question {activeIdx + 1} of {questions.length}
                </span>
              </div>
              {/* Big question card — reuses shared QuestionCard so dynamic-
                  source, auto-detect, and error flows all stay consistent. */}
              <div className="scale-[1.05] origin-top-left">
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
              </div>

              {/* Hint + arrow-key legend */}
              <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground/50">
                <kbd className="px-1.5 py-0.5 rounded border border-white/[0.1] bg-white/[0.03] font-mono text-[10px]">
                  ←
                </kbd>
                <kbd className="px-1.5 py-0.5 rounded border border-white/[0.1] bg-white/[0.03] font-mono text-[10px]">
                  →
                </kbd>
                <span>to navigate</span>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* RIGHT — live persona preview */}
        <div className="overflow-y-auto px-6 py-8 bg-white/[0.015]">
          <div className="sticky top-0">
            <div className="flex items-center gap-2 mb-4 text-xs uppercase tracking-wider text-primary/60">
              <Zap className="w-3.5 h-3.5" />
              <span className="font-semibold">Live preview</span>
            </div>
            <motion.div
              layout
              className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] to-transparent p-5"
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1">
                Persona
              </div>
              <div className="text-base font-semibold text-foreground leading-snug mb-4">
                {templateName ?? 'Untitled agent'}
              </div>

              {Object.entries(categoryBuckets).map(([catKey, qs]) => {
                const meta = CATEGORY_META[catKey] ?? FALLBACK_CATEGORY;
                const { Icon } = meta;
                return (
                  <div key={catKey} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon className={`w-3 h-3 ${meta.color}`} />
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color}`}
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
                            className={`flex items-start gap-2 w-full text-left rounded-md px-1.5 py-1 -mx-1.5 transition-colors ${
                              isCurrent ? 'bg-primary/10' : 'hover:bg-white/[0.03]'
                            }`}
                          >
                            {isBlocked ? (
                              <AlertCircle className="w-3 h-3 text-rose-400 mt-0.5 flex-shrink-0" />
                            ) : hasAnswer ? (
                              <Check className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                            ) : (
                              <CircleDot className="w-3 h-3 text-amber-400/60 mt-0.5 flex-shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] text-muted-foreground/60 truncate">
                                {q.question}
                              </div>
                              <div
                                className={`text-xs leading-tight truncate ${
                                  hasAnswer
                                    ? 'text-foreground/90 font-medium'
                                    : 'text-muted-foreground/40 italic'
                                }`}
                              >
                                {hasAnswer
                                  ? summarizeAnswer(answer)
                                  : 'Not yet set'}
                                {isAuto && hasAnswer && (
                                  <span className="ml-1.5 text-[9px] uppercase tracking-wider text-violet-400/80">
                                    auto
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
            <p className="mt-4 text-xs text-muted-foreground/50 leading-relaxed">
              Click any row above to jump to that question. Auto-detected
              values are inferred from your connected credentials.
            </p>
          </div>
        </div>
      </div>

      {/* Footer nav */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={prev}
          disabled={activeIdx === 0}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>
        <div className="flex items-center gap-3">
          {isAtEnd && canSubmit ? (
            <button
              type="button"
              onClick={onSubmit}
              className="flex items-center gap-2 px-6 py-2 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              {t.templates.adopt_modal.submit_all}
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              disabled={isAtEnd}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 transition-all"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
