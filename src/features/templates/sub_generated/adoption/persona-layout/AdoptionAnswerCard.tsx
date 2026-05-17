import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { GlyphDimension } from '@/features/shared/glyph';
import { DIM_META } from '@/features/shared/glyph/dimMeta';
import { DIM_LABEL } from '@/features/shared/glyph/persona-sigil';
import type { DynamicOptionState } from '../useDynamicQuestionOptions';
import { QuestionnaireHeroQuestion } from '../questionnaire/QuestionnaireHeroQuestion';
import {
  isStackable,
  resolveStackableOptions,
} from '../questionnaire/questionnaireHelpers';

interface AdoptionAnswerCardProps {
  /** The dimension whose questions this card is presenting. */
  dim: GlyphDimension;
  /** Questions targeting this dim (already filtered by selectedUseCaseIds). */
  questions: TransformQuestionResponse[];
  /** Map of question id → user answer. */
  userAnswers: Record<string, string>;
  /** Auto-detected question ids (vault match was unambiguous). */
  autoDetectedIds: Set<string>;
  /** Question ids blocked by missing credentials. */
  blockedQuestionIds: Set<string>;
  /** Per-question filtered option lists (vault-narrowed). */
  filteredOptions?: Record<string, string[]>;
  /** Per-question dynamic-source state (Sentry projects, Slack channels…). */
  dynamicOptions?: Record<string, DynamicOptionState>;
  /** Retry handler for dynamic option fetches. */
  onRetryDynamic?: (questionId: string) => void;
  /** Open the inline credential-add modal for a vault category. */
  onAddCredential?: (vaultCategory: string) => void;
  /** Map use_case_id → human title for the "Applies to" line. */
  useCaseTitleById?: Record<string, string>;
  /** Persist an answer for a question id. */
  onAnswerUpdated: (questionId: string, answer: string) => void;
  /** Close the card. Caller clears the active dim. */
  onClose: () => void;
}

/**
 * Inline answer card overlay rendered on top of the Persona Sigil when
 * the user clicks a pending petal. Reuses QuestionnaireHeroQuestion for
 * the actual answering UI so widget parity with the Classic tab is
 * preserved. Adds per-dim navigation (previous / next within the dim's
 * questions) and a Close button.
 *
 * When all questions in the dim are answered, the card flips to a
 * "done" state with a Close CTA — letting the user confirm before
 * dismissing.
 */
export function AdoptionAnswerCard({
  dim,
  questions,
  userAnswers,
  autoDetectedIds,
  blockedQuestionIds,
  filteredOptions,
  dynamicOptions,
  onRetryDynamic,
  onAddCredential,
  useCaseTitleById,
  onAnswerUpdated,
  onClose,
}: AdoptionAnswerCardProps) {
  const { t, tx } = useTranslation();

  // Order: unanswered first (most urgent), answered last. Stable within
  // each group by source order. The user lands on the first unanswered
  // question; pressing Next advances through them.
  const orderedQuestions = useMemo(() => {
    const unanswered = questions.filter((q) => !userAnswers[q.id]);
    const answered = questions.filter((q) => !!userAnswers[q.id]);
    return [...unanswered, ...answered];
  }, [questions, userAnswers]);

  const [activeIdx, setActiveIdx] = useState(0);

  // Re-anchor when the dim or question set changes (e.g. user clicked a
  // different petal). Land on the first unanswered question in the new
  // ordering.
  useEffect(() => {
    setActiveIdx(0);
  }, [dim, questions.length]);

  if (orderedQuestions.length === 0) {
    return null;
  }

  const activeQuestion = orderedQuestions[activeIdx] ?? orderedQuestions[0]!;
  const isBlocked = blockedQuestionIds.has(activeQuestion.id);
  const isAutoDetected = autoDetectedIds.has(activeQuestion.id);
  const answer = userAnswers[activeQuestion.id] ?? '';
  const options = resolveStackableOptions(
    activeQuestion,
    filteredOptions?.[activeQuestion.id],
  );
  const stackable = isStackable(activeQuestion, options.length);

  const unansweredCount = orderedQuestions.filter((q) => !userAnswers[q.id]).length;
  const allAnswered = unansweredCount === 0;

  const dimMeta = DIM_META[dim];
  const dimColor = dimMeta.color;
  const dimLabel = DIM_LABEL[dim];

  return (
    <AnimatePresence>
      <motion.div
        key={`${dim}-${activeQuestion.id}`}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-auto relative rounded-modal border bg-background/95 backdrop-blur-md shadow-elevation-3 w-full flex flex-col"
        style={{
          borderColor: `${dimColor}66`,
          boxShadow: `0 0 24px ${dimColor}33, 0 8px 32px rgba(0,0,0,0.35)`,
          maxHeight: 'min(85vh, 800px)',
        }}
      >
        {/* Dim-colored accent bar */}
        <div
          className="absolute top-0 left-0 w-full h-1 rounded-t-modal"
          style={{
            background: `linear-gradient(90deg, ${dimColor}, transparent)`,
          }}
        />

        {/* Header — dim label + close */}
        <div className="flex items-center gap-2 px-6 pt-4 pb-2">
          <span
            className="typo-label uppercase tracking-[0.2em] font-bold"
            style={{ color: dimColor }}
          >
            {dimLabel}
          </span>
          {orderedQuestions.length > 1 && (
            <span className="typo-caption text-foreground/55 tabular-nums">
              · {tx(t.templates.adopt_modal.question_number_of, {
                current: activeIdx + 1,
                total: orderedQuestions.length,
              })}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-card text-foreground/55 hover:text-foreground hover:bg-foreground/[0.06] transition-colors cursor-pointer"
            aria-label={t.common.close}
            title={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-8 pb-4 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <QuestionnaireHeroQuestion
            question={activeQuestion}
            answer={answer}
            options={options}
            isStackable={stackable}
            isBlocked={isBlocked}
            isAutoDetected={isAutoDetected}
            activeIdx={activeIdx}
            totalCount={orderedQuestions.length}
            isAtEnd={activeIdx === orderedQuestions.length - 1}
            canSubmit={false}
            onAnswerUpdated={onAnswerUpdated}
            onAddCredential={onAddCredential}
            filteredOptions={filteredOptions?.[activeQuestion.id]}
            dynamicState={dynamicOptions?.[activeQuestion.id]}
            onRetryDynamic={onRetryDynamic}
            useCaseTitleById={useCaseTitleById}
          />
        </div>

        {/* Footer — prev / next / done */}
        <div className="shrink-0 flex items-center gap-2 px-6 py-3 border-t border-card-border bg-foreground/[0.02] rounded-b-modal">
          <button
            type="button"
            onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            disabled={activeIdx === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full typo-caption text-foreground/75 hover:text-foreground hover:bg-foreground/[0.06] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t.templates.adopt_modal.previous}
          </button>

          <div className="flex-1 text-center">
            {allAnswered ? (
              <span className="typo-caption text-status-success inline-flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                {t.templates.adopt_modal.persona_layout_dim_all_answered}
              </span>
            ) : (
              <span className="typo-caption text-foreground/55">
                {tx(t.templates.adopt_modal.persona_layout_continue_remaining, {
                  count: unansweredCount,
                })}
              </span>
            )}
          </div>

          {activeIdx < orderedQuestions.length - 1 ? (
            <button
              type="button"
              onClick={() => setActiveIdx((i) => Math.min(orderedQuestions.length - 1, i + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full typo-caption text-foreground/75 hover:text-foreground hover:bg-foreground/[0.06] cursor-pointer transition-colors"
            >
              {t.templates.adopt_modal.next}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full typo-caption text-foreground bg-primary/25 hover:bg-primary/40 border border-primary/40 cursor-pointer transition-colors"
            >
              {t.templates.adopt_modal.persona_layout_dim_done}
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
