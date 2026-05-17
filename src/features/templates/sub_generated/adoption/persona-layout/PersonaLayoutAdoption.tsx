import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import {
  toDisplayUseCase,
  type DisplayUseCase,
} from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

/** Loose template design-result shape. The n8n transform's output doesn't
 *  conform to the strict `AgentIR` interface (use_cases lives at the top
 *  level here, not under design_context), so callers pass a Record. */
type TemplateDesignResult = Record<string, unknown>;
import { QuestionnaireHeaderBand } from '../questionnaire/QuestionnaireHeaderBand';
import { QuestionnaireStoryThread } from '../questionnaire/QuestionnaireStoryThread';

interface PersonaLayoutAdoptionProps {
  /** Template parsed design result — source of use cases for the rows. */
  designResult: TemplateDesignResult | null;
  /** Template name displayed in the hero band + stepper. */
  templateName: string;
  /** Selected use cases (drives row inclusion + filtered questions). */
  selectedUseCaseIds: Set<string>;
  /** Toggle a use case's inclusion in the persona being adopted. */
  onToggleUseCase: (id: string) => void;
  /** Adoption questions, already filtered to selected use cases + sorted. */
  questions: TransformQuestionResponse[];
  /** User answers collected so far. Read-only in this draft — answering
   *  happens via the Classic tab; this view is a preview + reorganiser. */
  userAnswers: Record<string, string>;
  /** IDs of questions auto-resolved from the vault (template's
   *  matchVaultToQuestions). Rendered with an "auto" badge in the story
   *  thread. */
  autoDetectedIds: Set<string>;
  /** IDs of questions blocked by missing credentials. Disables Continue. */
  blockedQuestionIds: Set<string>;
  /** Switch back to the Classic adoption flow — used when the user needs
   *  to answer or edit questions. */
  onSwitchToClassic: () => void;
  /** Continue past pre-seed and trigger the persona creation + build
   *  session. Disabled while any question is unanswered or blocked. */
  onContinue: () => void;
  /** Close the adoption modal. */
  onClose: () => void;
}

const NO_ACTIVE_QUESTION = -1;

/**
 * First-draft Persona Layout adoption surface (phase 2, commit C).
 *
 * Replaces the picker + questionnaire steps with a single screen showing:
 *   • Persona Sigil — union of dimensions from template's design_result
 *   • capability rows — each template use case as a row, power button =
 *     include/skip toggle (replaces UseCasePickerStep's role)
 *   • top stepper — QuestionnaireHeaderBand reused, no active question
 *   • right rail — QuestionnaireStoryThread reused, click an item to
 *     jump back to Classic with that question pre-focused
 *
 * Draft constraints (deferred to follow-up commits):
 *   • Questions can't be answered inline yet — clicking a story-thread
 *     item routes back to Classic tab. Inline per-petal answering is the
 *     phase-2 UX target but needs the petal-popover primitive first.
 *   • Per-row policy controls (memory / review / events) aren't wired
 *     here because no persona exists pre-seed; the policy controls
 *     currently persist via usePolicyControls which expects a personaId.
 *     Template-time policy overrides land via the questionnaire answers.
 *
 * Wires through the same data ChronologyAdoptionView assembles for
 * picker + questionnaire, so toggling between Classic and Persona Layout
 * tabs preserves all user input.
 */
export function PersonaLayoutAdoption({
  designResult,
  templateName,
  selectedUseCaseIds,
  onToggleUseCase,
  questions,
  userAnswers,
  autoDetectedIds,
  blockedQuestionIds,
  onSwitchToClassic,
  onContinue,
  onClose,
}: PersonaLayoutAdoptionProps) {
  const { t, tx } = useTranslation();

  const items = useMemo<DisplayUseCase[]>(() => {
    const raw = ((designResult?.use_cases ?? []) as unknown[]) as DesignUseCase[];
    return raw
      .map((uc) => {
        const id = String((uc as { id?: unknown }).id ?? '').trim();
        if (!id) return null;
        const enabled = selectedUseCaseIds.has(id);
        // Template use cases come from the n8n transform with most
        // DisplayUseCase fields already shaped correctly; we just need
        // to honour the user's include/skip toggle by overriding
        // `enabled` before the adapter computes the health pill.
        const seeded: DesignUseCase = { ...uc, id, enabled };
        return toDisplayUseCase(seeded);
      })
      .filter((u): u is DisplayUseCase => u !== null);
  }, [designResult, selectedUseCaseIds]);

  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const totalCount = questions.length;
  const blockedCount = blockedQuestionIds.size;
  const progressPct = totalCount === 0 ? 1 : answeredCount / totalCount;
  const remaining = totalCount - answeredCount;
  const canContinue = remaining === 0 && blockedCount === 0 && selectedUseCaseIds.size > 0;

  const topSlot =
    totalCount > 0 ? (
      <QuestionnaireHeaderBand
        templateName={templateName}
        questions={questions}
        userAnswers={userAnswers}
        blockedQuestionIds={blockedQuestionIds}
        activeIdx={NO_ACTIVE_QUESTION}
        answeredCount={answeredCount}
        totalCount={totalCount}
        blockedCount={blockedCount}
        progressPct={progressPct}
        onJumpTo={() => onSwitchToClassic()}
      />
    ) : null;

  const rightSlot =
    totalCount > 0 ? (
      <QuestionnaireStoryThread
        questions={questions}
        userAnswers={userAnswers}
        activeIdx={NO_ACTIVE_QUESTION}
        autoDetectedIds={autoDetectedIds}
        blockedQuestionIds={blockedQuestionIds}
        answeredCount={answeredCount}
        totalCount={totalCount}
        onJumpTo={() => onSwitchToClassic()}
      />
    ) : null;

  const continueDisabledReason = !canContinue
    ? blockedCount > 0
      ? tx(t.templates.adopt_modal.persona_layout_continue_blocked, { count: blockedCount })
      : remaining > 0
        ? tx(t.templates.adopt_modal.persona_layout_continue_remaining, { count: remaining })
        : selectedUseCaseIds.size === 0
          ? t.templates.adopt_modal.persona_layout_continue_no_capabilities
          : null
    : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        <PersonaLayout
          mode="adoption"
          personaName={templateName}
          items={items}
          onRowOpen={() => {
            // First-draft: clicking a row in adoption mode is a no-op.
            // Detail editing lives in the post-seed PersonaChronologyGlyph
            // surface for now — pre-seed only handles include/skip.
          }}
          onRowToggle={(uc) => onToggleUseCase(uc.id)}
          topSlot={topSlot}
          rightSlot={rightSlot}
          emptyNode={
            <div className="rounded-modal border border-card-border bg-secondary/30 p-8 text-center">
              <span className="typo-body text-foreground/70 italic">
                {t.templates.adopt_modal.persona_layout_no_capabilities}
              </span>
            </div>
          }
        />
      </div>

      <div className="shrink-0 border-t border-border bg-foreground/[0.02] px-5 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="typo-caption text-foreground/65 hover:text-foreground transition-colors cursor-pointer"
        >
          {t.templates.adopt_modal.cancel}
        </button>
        <button
          type="button"
          onClick={onSwitchToClassic}
          className="inline-flex items-center gap-1.5 typo-caption text-foreground/85 hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {t.templates.adopt_modal.persona_layout_edit_questions}
        </button>
        <div className="flex-1" />
        {continueDisabledReason && (
          <span className="typo-caption text-status-warning inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {continueDisabledReason}
          </span>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full border transition-colors typo-body ${
            canContinue
              ? 'bg-primary/25 hover:bg-primary/40 border-primary/40 text-foreground cursor-pointer'
              : 'bg-secondary/40 border-border/30 text-foreground/40 cursor-not-allowed'
          }`}
        >
          {t.templates.adopt_modal.persona_layout_continue_to_build}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
