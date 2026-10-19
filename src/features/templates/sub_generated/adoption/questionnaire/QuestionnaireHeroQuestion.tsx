import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Info, KeyRound } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { useTranslation } from '@/i18n/useTranslation';
import { QuestionCard } from '../QuestionnaireFormGridParts';
import type { DynamicOptionState } from '../useDynamicQuestionOptions';
import { QuestionnaireBlockedCredentialCta } from './QuestionnaireBlockedCredentialCta';
import { resolveBlockedCredentialCategory } from './questionnaireHelpers';
import { QuestionnaireStackedOptions } from './QuestionnaireStackedOptions';
import type { QuestionnaireNormalizedOption } from './types';
import { DebtText } from '@/i18n/DebtText';


interface QuestionnaireHeroQuestionProps {
  question: TransformQuestionResponse;
  answer: string;
  options: QuestionnaireNormalizedOption[];
  isStackable: boolean;
  isBlocked: boolean;
  isAutoDetected: boolean;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onAddCredential?: (vaultCategory: string) => void;
  filteredOptions?: string[];
  dynamicState?: DynamicOptionState;
  onRetryDynamic?: (questionId: string) => void;
  useCaseTitleById?: Record<string, string>;
}

/**
 * The hero question card inside AdoptionAnswerCard (its one caller). Renders
 * the question title, an optional collapsible context tip, and a type-appropriate
 * input widget below with generous breathing room. Stackable question types
 * (boolean, fixed-option select) get a one-per-row card layout with number
 * keyboard hints; rich types (dynamic_source, text, textarea, pickers) fall
 * through to the existing QuestionCard surface wrapped in a matching card.
 *
 * Position, category and the prev/next controls belong to the surrounding
 * sigil card, which is why this card draws no crumb or keyboard legend.
 */
export function QuestionnaireHeroQuestion({
  question,
  answer,
  options,
  isStackable,
  isBlocked,
  isAutoDetected,
  onAnswerUpdated,
  onAddCredential,
  filteredOptions,
  dynamicState,
  onRetryDynamic,
  useCaseTitleById,
}: QuestionnaireHeroQuestionProps) {
  const { t } = useTranslation();
  const [tipOpen, setTipOpen] = useState(false);

  // Collapse the context tip when the user navigates to another question.
  useEffect(() => {
    setTipOpen(false);
  }, [question.id]);

  const hasTip = !!question.context && !isBlocked;
  // Resolved rather than read straight off `vault_category`: a blocked
  // dynamic-source question never carries that field, so gating on it left the
  // question rendering as an ordinary picker that could not load and offered
  // no way to fix the block.
  const blockedCategory = isBlocked ? resolveBlockedCredentialCategory(question) : null;
  const appliesToIds =
    question.use_case_ids ?? (question.use_case_id ? [question.use_case_id] : []);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={question.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
      >
        {/* Title + badges */}
        <div className="flex items-start gap-3 mb-2">
          <h3 className="flex-1 typo-body-lg text-foreground">
            {question.question}
          </h3>
          {isAutoDetected && !isBlocked && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 typo-caption rounded-card bg-brand-purple/10 border border-brand-purple/30 text-brand-purple flex-shrink-0 mt-1">
              <KeyRound className="w-3.5 h-3.5" />
              {t.templates.adopt_modal.auto_detected}
            </span>
          )}
          {hasTip && (
            <button
              type="button"
              onClick={() => setTipOpen((v) => !v)}
              aria-expanded={tipOpen}
              aria-label={tipOpen ? t.templates.adopt_modal.hide_explanation : t.templates.adopt_modal.show_explanation}
              className={`flex-shrink-0 mt-1 p-1.5 rounded-card transition-colors ${
                tipOpen
                  ? 'bg-primary/15 text-primary'
                  : 'text-foreground hover:text-foreground hover:bg-foreground/[0.04]'
              }`}
            >
              <Info className="w-4 h-4" />
            </button>
          )}
        </div>

        <Collapse open={hasTip && tipOpen} unmountWhenClosed duration={200}>
          <div className="mt-3 px-4 py-3 rounded-card bg-foreground/[0.03] border border-border">
            <p className="typo-body text-foreground">
              {question.context}
            </p>
          </div>
        </Collapse>

        <div className="h-8" />

        {/* Input surface */}
        {blockedCategory && onAddCredential ? (
          <QuestionnaireBlockedCredentialCta
            category={blockedCategory}
            onAddCredential={onAddCredential}
          />
        ) : isStackable ? (
          <QuestionnaireStackedOptions
            options={options}
            value={answer}
            onChange={(v) => onAnswerUpdated(question.id, v)}
          />
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
              inputOnly
            />
          </div>
        )}

        {!isBlocked && appliesToIds.length > 0 && (
          <div className="mt-6 typo-body text-foreground italic">
            <DebtText k="auto_applies_to_ef612870" />{' '}
            {appliesToIds.map((id) => useCaseTitleById?.[id] ?? id).join(', ')}
          </div>
        )}

      </motion.div>
    </AnimatePresence>
  );
}
