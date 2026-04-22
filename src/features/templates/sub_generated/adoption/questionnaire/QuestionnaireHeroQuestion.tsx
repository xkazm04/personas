import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Info, KeyRound } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { useTranslation } from '@/i18n/useTranslation';
import { CATEGORY_META, FALLBACK_CATEGORY } from '../QuestionnaireFormGridConfig';
import { QuestionCard } from '../QuestionnaireFormGridParts';
import type { DynamicOptionState } from '../useDynamicQuestionOptions';
import { QuestionnaireBlockedCredentialCta } from './QuestionnaireBlockedCredentialCta';
import { QuestionnaireKeyboardHint } from './QuestionnaireKeyboardHint';
import { QuestionnaireStackedOptions } from './QuestionnaireStackedOptions';
import type { QuestionnaireNormalizedOption } from './types';

interface QuestionnaireHeroQuestionProps {
  question: TransformQuestionResponse;
  answer: string;
  options: QuestionnaireNormalizedOption[];
  isStackable: boolean;
  isBlocked: boolean;
  isAutoDetected: boolean;
  activeIdx: number;
  totalCount: number;
  isAtEnd: boolean;
  canSubmit: boolean;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onAddCredential?: (vaultCategory: string) => void;
  filteredOptions?: string[];
  dynamicState?: DynamicOptionState;
  onRetryDynamic?: (questionId: string) => void;
  useCaseTitleById?: Record<string, string>;
}

/**
 * Centre pane — the hero question card. Renders a category crumb, big
 * question title, optional collapsible context tip, and a type-appropriate
 * input widget below with generous breathing room. Stackable question types
 * (boolean, fixed-option select) get a one-per-row card layout with number
 * keyboard hints; rich types (dynamic_source, text, textarea, pickers) fall
 * through to the existing QuestionCard surface wrapped in a matching card.
 */
export function QuestionnaireHeroQuestion({
  question,
  answer,
  options,
  isStackable,
  isBlocked,
  isAutoDetected,
  activeIdx,
  totalCount,
  isAtEnd,
  canSubmit,
  onAnswerUpdated,
  onAddCredential,
  filteredOptions,
  dynamicState,
  onRetryDynamic,
  useCaseTitleById,
}: QuestionnaireHeroQuestionProps) {
  const { t, tx } = useTranslation();
  const [tipOpen, setTipOpen] = useState(false);

  // Collapse the context tip when the user navigates to another question.
  useEffect(() => {
    setTipOpen(false);
  }, [question.id]);

  const meta = CATEGORY_META[question.category ?? ''] ?? FALLBACK_CATEGORY;
  const { Icon } = meta;
  const hasTip = !!question.context && !isBlocked;
  const appliesToIds =
    question.use_case_ids ?? (question.use_case_id ? [question.use_case_id] : []);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={question.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {/* Category crumb */}
        <div className="flex items-center gap-2 mb-6 text-sm uppercase tracking-[0.18em]">
          <Icon className={`w-4 h-4 ${meta.color}`} />
          <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
          <span className="text-foreground/50">·</span>
          <span className="text-foreground/70 tabular-nums">
            {tx(t.templates.adopt_modal.question_number_of, {
              current: activeIdx + 1,
              total: totalCount,
            })}
          </span>
        </div>

        {/* Title + badges */}
        <div className="flex items-start gap-3 mb-2">
          <h3 className="flex-1 text-2xl font-medium text-foreground leading-snug">
            {question.question}
          </h3>
          {isAutoDetected && !isBlocked && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-card bg-brand-purple/10 border border-brand-purple/30 text-brand-purple flex-shrink-0 mt-1">
              <KeyRound className="w-3.5 h-3.5" />
              {t.templates.adopt_modal.auto_detected}
            </span>
          )}
          {hasTip && (
            <button
              type="button"
              onClick={() => setTipOpen((v) => !v)}
              aria-expanded={tipOpen}
              className={`flex-shrink-0 mt-1 p-1.5 rounded-card transition-colors ${
                tipOpen
                  ? 'bg-primary/15 text-primary'
                  : 'text-foreground/55 hover:text-foreground hover:bg-foreground/[0.04]'
              }`}
            >
              <Info className="w-4 h-4" />
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {hasTip && tipOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 px-4 py-3 rounded-card bg-foreground/[0.03] border border-border">
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {question.context}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-8" />

        {/* Input surface */}
        {isBlocked && question.vault_category && onAddCredential ? (
          <QuestionnaireBlockedCredentialCta
            category={question.vault_category}
            onAddCredential={onAddCredential}
          />
        ) : isStackable ? (
          <>
            <QuestionnaireStackedOptions
              options={options}
              value={answer}
              onChange={(v) => onAnswerUpdated(question.id, v)}
            />
            {options.length > 1 && (
              <div className="mt-4 text-xs text-foreground/55 flex items-center gap-2">
                <span>Press</span>
                <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.04] font-mono text-xs">
                  1
                </kbd>
                <span>–</span>
                <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.04] font-mono text-xs">
                  {Math.min(options.length, 9)}
                </kbd>
                <span>to pick.</span>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-card bg-background/60 border border-border backdrop-blur-sm p-4">
            <QuestionCard
              question={question}
              answer={answer}
              onAnswer={(v) => onAnswerUpdated(question.id, v)}
              isAutoDetected={isAutoDetected}
              isBlocked={isBlocked}
              onAddCredential={onAddCredential}
              filteredOptions={filteredOptions}
              dynamicState={dynamicState}
              onRetryDynamic={onRetryDynamic}
              useCaseTitleById={useCaseTitleById}
            />
          </div>
        )}

        {!isBlocked && appliesToIds.length > 0 && (
          <div className="mt-6 text-sm text-foreground/55 italic">
            Applies to:{' '}
            {appliesToIds.map((id) => useCaseTitleById?.[id] ?? id).join(', ')}
          </div>
        )}

        <QuestionnaireKeyboardHint isAtEnd={isAtEnd} canSubmit={canSubmit} />
      </motion.div>
    </AnimatePresence>
  );
}
