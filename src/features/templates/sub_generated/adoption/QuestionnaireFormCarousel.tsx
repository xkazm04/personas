/**
 * Carousel variant of the adoption questionnaire.
 *
 * Alternative to `QuestionnaireFormGrid` — shows ONE category panel at a
 * time in a center-modal frame, with framer-motion slide transitions between
 * steps. The user navigates via left/right chevrons, keyboard arrows, or
 * direct clicks on the progress dots at the bottom. The existing shared
 * `QuestionCard` component is reused so dynamic-source questions, custom
 * input, auto-detect badging, and error/retry flows all work identically.
 *
 * UX goals (vs the grid):
 *   - reduces intimidation on templates with many questions — you only see
 *     the current category
 *   - slide transitions give a feeling of progress and "moving through" the
 *     setup rather than staring at a wall of inputs
 *   - big pills, one category at a time, arrow-driven pacing reads well
 *     for first-time users
 */
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { useTranslation } from '@/i18n/useTranslation';
import type { DynamicOptionState } from './useDynamicQuestionOptions';
import {
  QuestionCard,
  CATEGORY_META,
  FALLBACK_CATEGORY,
  groupByCategory,
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
}

export function QuestionnaireFormCarousel({
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
}: Props) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupByCategory(questions), [questions]);
  const categoryKeys = useMemo(() => Object.keys(grouped), [grouped]);
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const panelRef = useRef<HTMLDivElement>(null);

  const totalSteps = categoryKeys.length;
  const currentKey = categoryKeys[stepIndex] ?? categoryKeys[0];
  const currentQuestions = grouped[currentKey ?? ''] ?? [];

  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const blockedCount = blockedQuestionIds?.size ?? 0;
  const allAnswered = answeredCount === questions.length;
  const canSubmit = allAnswered && blockedCount === 0;

  // Does every question in the current category have an answer + no block?
  const currentStepComplete = useMemo(() => {
    return currentQuestions.every(
      (q) => userAnswers[q.id] && !blockedQuestionIds?.has(q.id),
    );
  }, [currentQuestions, userAnswers, blockedQuestionIds]);

  const goToStep = useCallback(
    (next: number) => {
      if (next < 0 || next >= totalSteps) return;
      setDirection(next > stepIndex ? 1 : -1);
      setStepIndex(next);
      panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [stepIndex, totalSteps],
  );

  const next = useCallback(() => goToStep(stepIndex + 1), [goToStep, stepIndex]);
  const prev = useCallback(() => goToStep(stepIndex - 1), [goToStep, stepIndex]);

  // Keyboard navigation — left/right arrows, enter to advance
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

  const meta = CATEGORY_META[currentKey ?? ''] ?? FALLBACK_CATEGORY;
  const { Icon } = meta;
  const isLastStep = stepIndex === totalSteps - 1;

  // Slide variants for the current step panel — direction-aware so forward
  // navigation always feels like moving right and back feels like moving left.
  const slideVariants = {
    enter: (dir: 1 | -1) => ({ x: dir === 1 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: 1 | -1) => ({ x: dir === 1 ? -80 : 80, opacity: 0 }),
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Top progress + category badge */}
      <div className="flex-shrink-0 px-8 pt-6 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-primary/80" />
            <h2 className="text-lg font-semibold text-foreground">
              {t.templates.adopt_modal.configure_your_persona}
            </h2>
          </div>
          <div className="text-xs text-muted-foreground/60 tabular-nums">
            Step {stepIndex + 1} of {totalSteps} · {answeredCount}/{questions.length} answered
          </div>
        </div>
        {/* Dot indicator — clickable, shows completion state */}
        <div className="flex items-center gap-1.5">
          {categoryKeys.map((key, i) => {
            const qs = grouped[key]!;
            const complete = qs.every(
              (q) => userAnswers[q.id] && !blockedQuestionIds?.has(q.id),
            );
            const isActive = i === stepIndex;
            return (
              <button
                key={key}
                type="button"
                onClick={() => goToStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  isActive
                    ? 'w-8 bg-primary'
                    : complete
                      ? 'w-6 bg-emerald-500/60 hover:bg-emerald-500'
                      : 'w-4 bg-white/[0.1] hover:bg-white/[0.2]'
                }`}
                aria-label={`Go to ${CATEGORY_META[key]?.label ?? key}`}
              />
            );
          })}
        </div>
      </div>

      {/* Main stage — slide transition between category panels */}
      <div
        ref={panelRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
      >
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={currentKey}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="max-w-3xl mx-auto px-8 py-8"
          >
            {/* Category header */}
            <div className={`flex items-center gap-3 mb-6 pb-3 border-b ${meta.border}`}>
              <div
                className={`w-10 h-10 rounded-xl ${meta.bg} border ${meta.border} flex items-center justify-center`}
              >
                <Icon className={`w-5 h-5 ${meta.color}`} />
              </div>
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}
                >
                  Category
                </div>
                <div className="text-xl font-semibold text-foreground">
                  {meta.label}
                </div>
              </div>
              <div className="ml-auto text-sm text-muted-foreground/60">
                {currentQuestions.filter((q) => !!userAnswers[q.id]).length}/
                {currentQuestions.length} answered
              </div>
            </div>

            {/* Questions for this category */}
            <div className="space-y-3">
              {currentQuestions.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  answer={userAnswers[q.id] ?? ''}
                  onAnswer={(v) => onAnswerUpdated(q.id, v)}
                  isAutoDetected={autoDetectedIds?.has(q.id)}
                  isBlocked={blockedQuestionIds?.has(q.id)}
                  onAddCredential={onAddCredential}
                  filteredOptions={filteredOptions?.[q.id]}
                  dynamicState={dynamicOptions?.[q.id]}
                  onRetryDynamic={onRetryDynamic}
                />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Chevron rails — absolutely positioned on the sides */}
        <button
          type="button"
          onClick={prev}
          disabled={stepIndex === 0}
          className={`absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center transition-all ${
            stepIndex === 0
              ? 'opacity-20 cursor-not-allowed'
              : 'bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.1] hover:border-white/[0.15] text-foreground/80 hover:text-foreground'
          }`}
          aria-label="Previous category"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={next}
          disabled={stepIndex === totalSteps - 1}
          className={`absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center transition-all ${
            stepIndex === totalSteps - 1
              ? 'opacity-20 cursor-not-allowed'
              : 'bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.1] hover:border-white/[0.15] text-foreground/80 hover:text-foreground'
          }`}
          aria-label="Next category"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Footer — back/next or submit */}
      <div className="flex-shrink-0 flex items-center justify-between px-8 py-4 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={prev}
          disabled={stepIndex === 0}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>

        <div className="flex items-center gap-3">
          {blockedCount > 0 && (
            <span className="text-xs text-rose-300/70 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {blockedCount} credential{blockedCount === 1 ? '' : 's'} needed
            </span>
          )}
          {isLastStep ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={`flex items-center gap-2 px-6 py-2 text-sm font-medium rounded-xl transition-all ${
                canSubmit
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
                  : 'bg-white/[0.06] text-muted-foreground/40 cursor-not-allowed'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {t.templates.adopt_modal.submit_all}
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl transition-all ${
                currentStepComplete
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
                  : 'bg-white/[0.08] border border-white/[0.12] text-foreground/80 hover:bg-white/[0.12]'
              }`}
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

