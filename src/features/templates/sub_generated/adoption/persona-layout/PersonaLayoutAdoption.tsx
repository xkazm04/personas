import { useCallback, useMemo, useState } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
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
import type { DynamicOptionState } from '../useDynamicQuestionOptions';
import { AdoptionAnswerCard } from './AdoptionAnswerCard';
import { groupQuestionsByDimension, questionToDimension } from './questionDimMap';

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
  /** User answers collected so far. */
  userAnswers: Record<string, string>;
  /** Submit / update an answer. Used by the inline answer card. */
  onAnswerUpdated: (questionId: string, answer: string) => void;
  /** IDs of questions auto-resolved from the vault (template's
   *  matchVaultToQuestions). Rendered with an "auto" badge in the story
   *  thread + answer card. */
  autoDetectedIds: Set<string>;
  /** IDs of questions blocked by missing credentials. Disables Continue. */
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
  /** Continue past pre-seed and trigger the persona creation + build
   *  session. Disabled while any question is unanswered or blocked. */
  onContinue: () => void;
  /** Close the adoption modal. */
  onClose: () => void;
}

/**
 * Persona Layout adoption surface (phase 2 / refined in 2026-05-17).
 *
 * One screen replaces the picker + questionnaire steps:
 *   • Top — QuestionnaireHeaderBand stepper (reused from Classic)
 *   • Hero — Persona Sigil at 640px (canonical), petals reflect template
 *     coverage and any pending adoption questions (amber = pending)
 *   • Right rail — QuestionnaireStoryThread (reused from Classic). Click
 *     a thread item to open its dim's answer card on the sigil.
 *   • Below hero — Continue button + reasons-disabled microcopy
 *   • Capability rows — each template use case as a row, power button =
 *     include/skip toggle
 *
 * Inline question answering: clicking a pending petal opens an
 * AdoptionAnswerCard overlay in the sigil center. The card reuses
 * QuestionnaireHeroQuestion for widget parity with Classic, and lets the
 * user step through every question landing on that dim (prev / next /
 * done). When all questions for a dim are answered, the petal flips to
 * resolved and the card auto-flips to a done state.
 */
export function PersonaLayoutAdoption({
  designResult,
  templateName,
  selectedUseCaseIds,
  onToggleUseCase,
  questions,
  userAnswers,
  onAnswerUpdated,
  autoDetectedIds,
  blockedQuestionIds,
  filteredOptions,
  dynamicOptions,
  onRetryDynamic,
  onAddCredential,
  useCaseTitleById,
  onContinue,
  onClose,
}: PersonaLayoutAdoptionProps) {
  const { t, tx } = useTranslation();
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);

  // Template use cases → display rows. Honour the include/skip toggle by
  // overriding `enabled` before the adapter computes the health pill.
  const items = useMemo<DisplayUseCase[]>(() => {
    const raw = ((designResult?.use_cases ?? []) as unknown[]) as DesignUseCase[];
    return raw
      .map((uc) => {
        const id = String((uc as { id?: unknown }).id ?? '').trim();
        if (!id) return null;
        const enabled = selectedUseCaseIds.has(id);
        const seeded: DesignUseCase = { ...uc, id, enabled };
        return toDisplayUseCase(seeded);
      })
      .filter((u): u is DisplayUseCase => u !== null);
  }, [designResult, selectedUseCaseIds]);

  // Questions grouped by their target dim — drives petal state + the
  // answer-card's question stack on click.
  const questionsByDim = useMemo(
    () => groupQuestionsByDimension(questions),
    [questions],
  );

  // Petal states: pending when any question for the dim is unanswered,
  // else resolved when the template has design data on that dim or a
  // question landed answered.
  const petalStates = useMemo<Record<GlyphDimension, PetalState>>(() => {
    // Dims touched by enabled template capabilities (so coverage stays
    // visible even without questions).
    const designDims = new Set<GlyphDimension>();
    for (const uc of items) {
      if (uc.health === 'disabled') continue;
      for (const d of uc.dimensions) designDims.add(d);
    }

    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      const dimQuestions = questionsByDim[dim];
      const hasUnanswered = dimQuestions.some(
        (q) => !userAnswers[q.id] && !blockedQuestionIds.has(q.id),
      );
      const hasBlocked = dimQuestions.some((q) => blockedQuestionIds.has(q.id));
      if (hasUnanswered || hasBlocked) {
        out[dim] = 'pending';
      } else if (dimQuestions.length > 0 || designDims.has(dim)) {
        out[dim] = 'resolved';
      } else {
        out[dim] = 'idle';
      }
    }
    return out;
  }, [items, questionsByDim, userAnswers, blockedQuestionIds]);

  const handlePetalClick = useCallback(
    (dim: GlyphDimension) => {
      // Only opens when this dim has questions tied to it; otherwise
      // there's nothing to answer and the click is a no-op (with a
      // small toggle for the highlight).
      if (questionsByDim[dim].length === 0) {
        setActiveDim((prev) => (prev === dim ? null : dim));
        return;
      }
      setActiveDim((prev) => (prev === dim ? null : dim));
    },
    [questionsByDim],
  );

  // Story-thread item click → jump to the question's dim and open its
  // answer card (no more bouncing back to Classic).
  const handleStoryJumpTo = useCallback(
    (idx: number) => {
      const q = questions[idx];
      if (!q) return;
      setActiveDim(questionToDimension(q));
    },
    [questions],
  );

  // Header-band stepper click → same behaviour as the story thread.
  const handleHeaderJumpTo = useCallback(
    (idx: number) => handleStoryJumpTo(idx),
    [handleStoryJumpTo],
  );

  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const totalCount = questions.length;
  const blockedCount = blockedQuestionIds.size;
  const progressPct = totalCount === 0 ? 1 : answeredCount / totalCount;
  const remaining = totalCount - answeredCount;
  const canContinue = remaining === 0 && blockedCount === 0 && selectedUseCaseIds.size > 0;

  const activeStoryIdx = useMemo(() => {
    if (!activeDim) return -1;
    // Light up every question for the active dim in the thread (use the
    // first one as the "current" anchor).
    const first = questions.findIndex((q) => questionToDimension(q) === activeDim);
    return first;
  }, [questions, activeDim]);

  const topSlot =
    totalCount > 0 ? (
      <QuestionnaireHeaderBand
        templateName={templateName}
        questions={questions}
        userAnswers={userAnswers}
        blockedQuestionIds={blockedQuestionIds}
        activeIdx={activeStoryIdx}
        answeredCount={answeredCount}
        totalCount={totalCount}
        blockedCount={blockedCount}
        progressPct={progressPct}
        onJumpTo={handleHeaderJumpTo}
      />
    ) : null;

  const rightSlot =
    totalCount > 0 ? (
      <QuestionnaireStoryThread
        questions={questions}
        userAnswers={userAnswers}
        activeIdx={activeStoryIdx}
        autoDetectedIds={autoDetectedIds}
        blockedQuestionIds={blockedQuestionIds}
        answeredCount={answeredCount}
        totalCount={totalCount}
        onJumpTo={handleStoryJumpTo}
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

  const centerOverlay = activeDim ? (
    <AdoptionAnswerCard
      dim={activeDim}
      questions={questionsByDim[activeDim]}
      userAnswers={userAnswers}
      autoDetectedIds={autoDetectedIds}
      blockedQuestionIds={blockedQuestionIds}
      filteredOptions={filteredOptions}
      dynamicOptions={dynamicOptions}
      onRetryDynamic={onRetryDynamic}
      onAddCredential={onAddCredential}
      useCaseTitleById={useCaseTitleById}
      onAnswerUpdated={onAnswerUpdated}
      onClose={() => setActiveDim(null)}
    />
  ) : remaining > 0 ? (
    <span className="typo-caption text-foreground/55 italic pointer-events-none">
      {t.templates.adopt_modal.persona_layout_dim_open_hint}
    </span>
  ) : (
    <span aria-hidden />
  );

  const belowHero = (
    <div className="flex items-center justify-center gap-3 flex-wrap">
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
        className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-full border transition-colors typo-body ${
          canContinue
            ? 'bg-primary/25 hover:bg-primary/40 border-primary/40 text-foreground cursor-pointer'
            : 'bg-secondary/40 border-border/30 text-foreground/40 cursor-not-allowed'
        }`}
      >
        {t.templates.adopt_modal.persona_layout_continue_to_build}
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        <PersonaLayout
          mode="adoption"
          personaName={templateName}
          items={items}
          onRowOpen={() => {
            // Detail editing pre-seed is a no-op; in-card answering covers
            // the per-question flow.
          }}
          onRowToggle={(uc) => onToggleUseCase(uc.id)}
          topSlot={topSlot}
          rightSlot={rightSlot}
          heroPetalStatesOverride={petalStates}
          onHeroPetalClick={handlePetalClick}
          heroActiveDim={activeDim}
          heroCenterOverlay={centerOverlay}
          belowHeroSlot={belowHero}
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
      </div>
    </div>
  );
}
