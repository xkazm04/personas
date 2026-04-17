import { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Send, X, Sparkles,
  AlertCircle, Plus,
} from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { DynamicOptionState } from './useDynamicQuestionOptions';
import { useTranslation } from '@/i18n/useTranslation';
import {
  CATEGORY_META, FALLBACK_CATEGORY,
  containerVariants, sectionVariants,
  groupByCategory,
} from './QuestionnaireFormGridConfig';
import { ProgressBar, QuestionCard } from './QuestionnaireFormGridParts';

// Re-export so existing importers resolve without changes
export { CATEGORY_META, FALLBACK_CATEGORY, groupByCategory } from './QuestionnaireFormGridConfig';
export { SelectPills } from './QuestionnaireFormGridParts';
export type { PillOption } from './QuestionnaireFormGridParts';
export { QuestionCard } from './QuestionnaireFormGridParts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionnaireFormGridProps {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  /** Question IDs that were auto-answered from the credential vault. */
  autoDetectedIds?: Set<string>;
  /** Question IDs that are blocked because no vault credential exists for the category. */
  blockedQuestionIds?: Set<string>;
  /** Vault-narrowed option lists per question ID. Applied when 2+ credentials match. */
  filteredOptions?: Record<string, string[]>;
  /**
   * Per-question state from `useDynamicQuestionOptions` — populated for any
   * question whose template JSON carries a `dynamic_source`. Covers loading,
   * error, and the actual list of `{value, label, sublabel}` items fetched
   * from the backing connector (Sentry, codebases, ...).
   */
  dynamicOptions?: Record<string, DynamicOptionState>;
  /** Retry the dynamic fetch for a specific question id. */
  onRetryDynamic?: (questionId: string) => void;
  /** Called when the user clicks "Add credential" on a blocked question. Passes the vault category. */
  onAddCredential?: (vaultCategory: string) => void;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  /**
   * When true, render the questionnaire as inline content (no BaseModal
   * wrapper). Used by `MatrixAdoptionView` to embed the questionnaire as the
   * primary view of the Adoption Wizard, avoiding the stacked-portal /
   * loading-screen confusion that happened when this rendered its own modal
   * on top of the wizard.
   */
  inline?: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuestionnaireFormGrid({
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
  onClose,
  inline = false,
}: QuestionnaireFormGridProps) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupByCategory(questions), [questions]);
  const categoryKeys = useMemo(() => Object.keys(grouped), [grouped]);

  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const totalCount = questions.length;
  const blockedCount = blockedQuestionIds?.size ?? 0;
  const allAnswered = answeredCount === totalCount;
  const canSubmit = allAnswered && blockedCount === 0;
  const remaining = totalCount - answeredCount;

  // Collect unique vault categories from blocked questions for the top callout
  const blockedCategories = useMemo(() => {
    if (!blockedQuestionIds || blockedQuestionIds.size === 0) return [];
    const seen = new Set<string>();
    const out: { category: string; questionLabels: string[] }[] = [];
    for (const q of questions) {
      if (!blockedQuestionIds.has(q.id) || !q.vault_category) continue;
      if (seen.has(q.vault_category)) {
        const existing = out.find((c) => c.category === q.vault_category);
        existing?.questionLabels.push(q.question);
      } else {
        seen.add(q.vault_category);
        out.push({ category: q.vault_category, questionLabels: [q.question] });
      }
    }
    return out;
  }, [questions, blockedQuestionIds]);

  // Auto-focus first unanswered text input on mount
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [firstUnansweredId] = useState(() => {
    const q = questions.find((q) => !userAnswers[q.id] && q.type === 'text');
    return q?.id ?? null;
  });

  useEffect(() => {
    const timer = setTimeout(() => firstInputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, []);

  const body = (
      <div className={inline ? "flex flex-col h-full min-h-0" : "flex flex-col max-h-[85vh]"}>
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-primary/80" />
              <h2 id="questionnaire-form-grid" className="text-lg font-semibold text-foreground">
                {t.templates.adopt_modal.configure_your_persona}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-card text-muted-foreground/50 hover:text-foreground/80 hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
          <ProgressBar answered={answeredCount} total={totalCount} />
        </div>

        {/* ── Scrollable grid ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Prominent blocked-state callout — shown when any required vault
              category has no matching credentials in the user's vault */}
          {blockedCategories.length > 0 && onAddCredential && (
            <div className="mb-5 rounded-modal border border-rose-500/30 bg-rose-500/[0.06] p-4">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-rose-300 mb-1">
                    {t.templates.adopt_modal.credentials_required_title}
                  </h3>
                  <p className="text-sm text-rose-300/80 leading-relaxed">
                    {t.templates.adopt_modal.credentials_required_body}
                  </p>
                </div>
              </div>
              <div className="space-y-2 ml-8">
                {blockedCategories.map(({ category, questionLabels }) => (
                  <div key={category} className="flex items-center justify-between gap-3 p-2.5 rounded-card bg-rose-500/[0.04] border border-rose-500/15">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 capitalize">{category}</div>
                      <div className="text-xs text-muted-foreground/60 truncate">
                        {questionLabels.join(' · ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddCredential(category)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-card bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30 transition-colors flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t.templates.adopt_modal.add_credential}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            {categoryKeys.map((catKey) => {
              const meta = CATEGORY_META[catKey] ?? FALLBACK_CATEGORY;
              const qs = grouped[catKey]!;
              const { Icon } = meta;

              return (
                <motion.div
                  key={catKey}
                  variants={sectionVariants}
                  className={`rounded-modal border ${meta.border} ${meta.bg} overflow-hidden`}
                  style={{ borderLeftWidth: 3 }}
                >
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                    <Icon className={`w-4 h-4 ${meta.color}`} />
                    <span className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto">
                      {qs.filter((q) => !!userAnswers[q.id]).length}/{qs.length}
                    </span>
                  </div>

                  {/* Questions */}
                  <div className="px-2 pb-3 space-y-1">
                    {qs.map((q) => (
                      <QuestionCard
                        key={q.id}
                        question={q}
                        answer={userAnswers[q.id] ?? ''}
                        onAnswer={(v) => onAnswerUpdated(q.id, v)}
                        inputRef={q.id === firstUnansweredId ? firstInputRef : undefined}
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
              );
            })}
          </motion.div>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground/50 hover:text-foreground/70 transition-colors"
          >
            {t.templates.adopt_modal.cancel}
          </button>

          <div className="flex items-center gap-3">
            {blockedCount > 0 && (
              <span className="text-xs text-rose-300/70 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {t.templates.adopt_modal.blocked_blocking_submit.replace('{count}', String(blockedCount))}
              </span>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-modal transition-all ${
                canSubmit
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-elevation-3 shadow-primary/20'
                  : 'bg-white/[0.06] text-muted-foreground/40 cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              {allAnswered ? t.templates.adopt_modal.submit_all : t.templates.adopt_modal.submit_remaining.replace('{remaining}', String(remaining))}
            </button>
          </div>
        </div>
      </div>
  );

  if (inline) return body;

  return (
    <BaseModal isOpen onClose={onClose} titleId="questionnaire-form-grid" size="6xl" portal>
      {body}
    </BaseModal>
  );
}
