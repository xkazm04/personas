import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { PersonaSigilSummary, type PersonaSigilSummaryEntry } from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import { CapabilityTabBar } from '@/features/shared/glyph/persona-layout/CapabilityTabBar';
import { updateBuildSessionDisabledDims } from '@/api/agents/buildSession';
import { silentCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';
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
  // Tracks which specific question within `activeDim` is on screen. Story-
  // thread clicks set both this AND activeDim so the answer card lands on
  // the EXACT question the user picked, not just the first one for its
  // dim. Without this, clicking the 2nd/3rd question in a dim's bucket
  // would silently route to the dim's first question (the bug Classic
  // didn't have because it indexed questions absolutely, not by dim).
  // Cleared whenever the dim changes via petal click (the card defaults
  // to first-unanswered in the new dim).
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  // Active capability for the per-cap tab strip. Default = first item;
  // re-anchor when items load or the prior pick disappears. Drives:
  //   - which capability the hero glyph renders
  //   - which capability's questions feed the questionnaire flow
  //   - which capability the left summary describes
  // Single-cap templates skip the tab strip entirely (see capabilityTabs
  // below) so a template like Email Morning Digest doesn't waste header
  // height on a one-item nav.
  const [activeCapabilityId, setActiveCapabilityId] = useState<string | null>(null);

  // Per-capability disabled-dims map — drives the petal-disabled state +
  // question filtering. Toggle UX in adoption lives inside the existing
  // AdoptionAnswerCard (added as a footer affordance) rather than a
  // separate SigilEditModal, since the AnswerCard already occupies the
  // hero's wideOverlay slot during the questionnaire flow. Persists to
  // the build session row via updateBuildSessionDisabledDims so the
  // runner reads the same shape the View mode persists on the persona.
  const [disabledDimsByCap, setDisabledDimsByCap] = useState<Record<string, Set<GlyphDimension>>>({});
  const sessionId = useAgentStore((s) => s.buildSessionId);
  const sessionDisabledDims = useAgentStore((s) => s.activeBuildSessionId
    ? (s.buildSessions[s.activeBuildSessionId] as unknown as { disabledDims?: Record<string, string[]> } | undefined)?.disabledDims
    : undefined);
  // Hydrate from session on first render or session change. Failures
  // (malformed shape) leave the map empty rather than blocking the panel.
  useEffect(() => {
    if (!sessionDisabledDims) {
      setDisabledDimsByCap({});
      return;
    }
    try {
      const next: Record<string, Set<GlyphDimension>> = {};
      for (const [capId, dims] of Object.entries(sessionDisabledDims)) {
        if (Array.isArray(dims)) next[capId] = new Set(dims as GlyphDimension[]);
      }
      setDisabledDimsByCap(next);
    } catch {
      setDisabledDimsByCap({});
    }
  }, [sessionDisabledDims]);

  const disabledDimsForActive = useMemo(() => {
    if (!activeCapabilityId) return new Set<GlyphDimension>();
    return disabledDimsByCap[activeCapabilityId] ?? new Set<GlyphDimension>();
  }, [activeCapabilityId, disabledDimsByCap]);

  const toggleDimDisabled = useCallback(
    (dim: GlyphDimension, nextActive: boolean) => {
      if (!activeCapabilityId || !sessionId) return;
      setDisabledDimsByCap((prev) => {
        const cur = new Set(prev[activeCapabilityId] ?? []);
        if (nextActive) cur.delete(dim);
        else cur.add(dim);
        const next = { ...prev, [activeCapabilityId]: cur };
        // Serialise and persist; empty sets stripped so the wire shape
        // stays clean.
        const wire: Record<string, GlyphDimension[]> = {};
        for (const [capId, set] of Object.entries(next)) {
          if (set.size > 0) wire[capId] = [...set];
        }
        const json = Object.keys(wire).length > 0 ? JSON.stringify(wire) : null;
        void updateBuildSessionDisabledDims(sessionId, json)
          .catch(silentCatch('PersonaLayoutAdoption:toggleDimDisabled'));
        return next;
      });
    },
    [activeCapabilityId, sessionId],
  );

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

  // Re-anchor active capability when items load / change. Preserve the
  // user's choice when still valid; only fall back to items[0] when the
  // prior pick disappears (e.g. template re-fetch dropped a cap).
  useEffect(() => {
    if (items.length === 0) {
      setActiveCapabilityId(null);
      return;
    }
    if (!activeCapabilityId || !items.some((u) => u.id === activeCapabilityId)) {
      setActiveCapabilityId(items[0]!.id);
    }
  }, [items, activeCapabilityId]);

  // Questions filtered by the active capability AND skipping any whose
  // dim has been toggled off via the SigilEditModal toggle. Each template
  // question carries `use_case_id` (sigil migration §1) and `dimension`
  // (sigil migration §2), so the filter is a single lookup. Questions
  // without `use_case_id` (legacy fallback) show under every cap; same
  // for ones without `dimension` (treat them as ungated).
  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      const ucId = (q as { use_case_id?: string }).use_case_id;
      const dim = (q as { dimension?: string }).dimension;
      // Cap scope (skip when activeCapabilityId is set and cap differs)
      if (ucId && activeCapabilityId && items.length > 1 && ucId !== activeCapabilityId) {
        return false;
      }
      // Disabled-dim gate
      if (ucId && dim) {
        const dis = disabledDimsByCap[ucId];
        if (dis && dis.has(dim as GlyphDimension)) return false;
      }
      return true;
    });
  }, [questions, activeCapabilityId, items.length, disabledDimsByCap]);

  // Questions grouped by their target dim — drives petal state + the
  // answer-card's question stack on click. Built from the cap-filtered
  // set so the hero glyph + answer card see only the active cap's
  // questions.
  const questionsByDim = useMemo(
    () => groupQuestionsByDimension(filteredQuestions),
    [filteredQuestions],
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
      // Disabled-dim trumps everything — render as idle so the petal
      // visually communicates "off" regardless of underlying question
      // state. The dim's questions are already filtered out of
      // `filteredQuestions` (and thus `questionsByDim`) above.
      if (disabledDimsForActive.has(dim)) {
        out[dim] = 'idle';
        continue;
      }
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
  }, [items, questionsByDim, userAnswers, blockedQuestionIds, disabledDimsForActive]);

  const handlePetalClick = useCallback(
    (dim: GlyphDimension) => {
      // Petal click clears any explicit question pin — the card lands on
      // the new dim's first-unanswered. The two paths into the card need
      // to disagree here: story-thread clicks pick a specific question;
      // petal clicks pick a dim and let the card choose.
      setActiveQuestionId(null);
      if (questionsByDim[dim].length === 0) {
        setActiveDim((prev) => (prev === dim ? null : dim));
        return;
      }
      setActiveDim((prev) => (prev === dim ? null : dim));
    },
    [questionsByDim],
  );

  // Story-thread item click → jump to the EXACT question the user clicked,
  // not just its dim. Both activeDim (drives which card opens) and
  // activeQuestionId (drives which entry inside the card is active) are
  // set in the same tick so the card lands precisely. Without this pair,
  // clicking the 2nd/3rd question in a dim's bucket silently routed to
  // the dim's first question — the bug Classic didn't have because it
  // indexed questions absolutely.
  const handleStoryJumpTo = useCallback(
    (idx: number) => {
      const q = filteredQuestions[idx];
      if (!q) return;
      setActiveDim(questionToDimension(q));
      setActiveQuestionId(q.id);
    },
    [filteredQuestions],
  );

  // Header-band stepper click → same behaviour as the story thread.
  const handleHeaderJumpTo = useCallback(
    (idx: number) => handleStoryJumpTo(idx),
    [handleStoryJumpTo],
  );

  const answeredCount = useMemo(
    () => filteredQuestions.filter((q) => !!userAnswers[q.id]).length,
    [filteredQuestions, userAnswers],
  );
  const totalCount = filteredQuestions.length;
  // `blockedQuestionIds` is derived from the VAULT (matchVaultToQuestions)
  // and never inspects user answers — once a question has been picked
  // from the stackable options, the user has explicitly resolved it,
  // even if the chosen service_type doesn't yet have a credential in
  // the vault (the credential add can happen post-adoption). Subtract
  // answered questions from the blocking set so picking a valid option
  // actually clears the gate.
  const blockedCount = useMemo(
    () => Array.from(blockedQuestionIds).filter((id) => !userAnswers[id]).length,
    [blockedQuestionIds, userAnswers],
  );
  const progressPct = totalCount === 0 ? 1 : answeredCount / totalCount;
  const remaining = totalCount - answeredCount;
  // Templates without declared use_cases (recipe-driven templates) produce
  // an empty `items` array — there's nothing for the user to enable. Don't
  // gate Continue on `selectedUseCaseIds.size > 0` in that case; the
  // adoption flow seeds capabilities at build time. When the template DOES
  // declare use cases, keep the original gate so the user must enable at
  // least one.
  const canContinue =
    remaining === 0 &&
    blockedCount === 0 &&
    (items.length === 0 || selectedUseCaseIds.size > 0);

  const activeStoryIdx = useMemo(() => {
    if (!activeDim) return -1;
    // Prefer the explicit question pin (set by story-thread / header-band
    // clicks) so the highlighted item matches what the user actually
    // clicked. Falls back to the first question for the dim when the dim
    // was opened via petal click (no specific question targeted).
    if (activeQuestionId) {
      const exact = filteredQuestions.findIndex((q) => q.id === activeQuestionId);
      if (exact >= 0) return exact;
    }
    return filteredQuestions.findIndex((q) => questionToDimension(q) === activeDim);
  }, [filteredQuestions, activeDim, activeQuestionId]);

  // Summary sidebar entries — one row per dim with at least one answered
  // question. Each row shows the dim label (colored to match the petal)
  // and a `·`-joined list of the user's picked values, so the user can
  // see what they've decided at a glance while the sigil itself stays
  // colour-coded for "still pending vs resolved".
  const summaryEntries = useMemo<Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>>>(() => {
    const dimLabels: Record<GlyphDimension, string> = {
      trigger: t.templates.chronology.dim_trigger,
      task: t.templates.chronology.dim_task,
      connector: t.templates.chronology.dim_apps,
      message: t.templates.chronology.dim_messages,
      review: t.templates.chronology.dim_human_review,
      memory: t.templates.chronology.dim_memory,
      event: t.templates.chronology.dim_events,
      error: t.templates.chronology.dim_error_handling,
    };
    const byDim = new Map<GlyphDimension, string[]>();
    for (const q of filteredQuestions) {
      const ans = userAnswers[q.id];
      if (!ans) continue;
      const dim = questionToDimension(q);
      const list = byDim.get(dim);
      if (list) list.push(ans);
      else byDim.set(dim, [ans]);
    }
    const out: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>> = {};
    for (const [dim, values] of byDim) {
      out[dim] = { label: dimLabels[dim], value: values.join(' · ') };
    }
    return out;
  }, [filteredQuestions, userAnswers, t]);

  const leftSlot = Object.keys(summaryEntries).length > 0 ? (
    <PersonaSigilSummary entries={summaryEntries} heading={null} />
  ) : null;

  // topSlot is defined below the `continueDisabledReason` derivation so
  // we can fold the Continue action into the header band. User feedback
  // (2026-05-17): the action panel below the sigil and the band above
  // it were doing two-bar duty; merge into one.

  const rightSlot =
    totalCount > 0 ? (
      <QuestionnaireStoryThread
        questions={filteredQuestions}
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

  const headerAction =
    totalCount > 0 ? (
      <div className="flex items-center gap-3 self-center shrink-0">
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
          data-testid="adopt-continue-to-build"
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
    ) : null;

  // Tab strip rendered above the questionnaire header band when the
  // template ships more than one capability. Single-cap templates skip
  // the strip (zero-info nav). On tab click, swap the active cap; the
  // questionnaire below auto-filters via `filteredQuestions`. The
  // existing pin state (activeDim + activeQuestionId) is cleared on
  // cap change so the answer card lands fresh on the new cap's first
  // unanswered question.
  const handleActiveCapChange = useCallback(
    (id: string) => {
      setActiveCapabilityId(id);
      setActiveDim(null);
      setActiveQuestionId(null);
    },
    [],
  );

  const capabilityTabs = items.length > 1 ? (
    <CapabilityTabBar
      items={items}
      activeId={activeCapabilityId}
      onActiveChange={handleActiveCapChange}
    />
  ) : null;

  const topSlot =
    totalCount > 0 ? (
      <div className="flex flex-col gap-3">
        {capabilityTabs}
        <div className="flex items-stretch gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <QuestionnaireHeaderBand
              templateName={templateName}
              questions={filteredQuestions}
              userAnswers={userAnswers}
              blockedQuestionIds={blockedQuestionIds}
              activeIdx={activeStoryIdx}
              answeredCount={answeredCount}
              totalCount={totalCount}
              blockedCount={blockedCount}
              progressPct={progressPct}
              onJumpTo={handleHeaderJumpTo}
            />
          </div>
          {headerAction}
        </div>
      </div>
    ) : capabilityTabs;

  // Open the first unanswered question (regardless of which dim it
  // lands on) when the user clicks the center count-button.
  const openFirstUnanswered = useCallback(() => {
    const next = filteredQuestions.find((q) => !userAnswers[q.id]);
    if (!next) return;
    setActiveDim(questionToDimension(next));
  }, [filteredQuestions, userAnswers]);

  // Wide overlay — the answer card, positioned absolute over the sigil
  // stage so it can be wider than the sigil itself (target: ~1280px on
  // desktop, capped by PersonaHero's overlay container).
  const wideOverlay = activeDim ? (
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
      pinnedQuestionId={activeQuestionId}
      onQuestionChange={setActiveQuestionId}
      isDimActive={!disabledDimsForActive.has(activeDim)}
      onToggleDim={(next) => toggleDimDisabled(activeDim, next)}
      onClose={() => {
        setActiveDim(null);
        setActiveQuestionId(null);
      }}
    />
  ) : undefined;

  // Center overlay — sits inside the sigil's inner core. When questions
  // are pending, surface a click-to-open count button so the user has
  // a clear "start here" affordance even without targeting a specific
  // petal. Hidden once every question is answered.
  const unansweredCount = remaining;
  const centerOverlay = !activeDim && unansweredCount > 0 ? (
    <button
      type="button"
      onClick={openFirstUnanswered}
      className="pointer-events-auto group flex flex-col items-center gap-1.5 px-5 py-3 rounded-modal bg-status-warning/10 hover:bg-status-warning/20 border border-status-warning/40 hover:border-status-warning/65 text-foreground cursor-pointer transition-all"
      title={t.templates.adopt_modal.persona_layout_center_open_questions_title}
    >
      <span className="typo-data font-mono text-2xl text-status-warning tabular-nums leading-none">
        {unansweredCount}
      </span>
      <span className="typo-label uppercase tracking-[0.18em] text-foreground/85">
        {unansweredCount === 1
          ? t.templates.adopt_modal.persona_layout_center_questions_to_answer_one
          : t.templates.adopt_modal.persona_layout_center_questions_to_answer_other}
      </span>
      <span className="typo-caption text-foreground/55 italic group-hover:text-foreground/80 transition-colors">
        {t.templates.adopt_modal.persona_layout_center_click_to_start}
      </span>
    </button>
  ) : !activeDim && unansweredCount === 0 && totalCount > 0 ? (
    <span className="typo-caption text-status-success italic pointer-events-none">
      {t.templates.adopt_modal.persona_layout_dim_all_answered}
    </span>
  ) : (
    <span aria-hidden />
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
          leftSlot={leftSlot}
          rightSlot={rightSlot}
          heroPetalStatesOverride={petalStates}
          onHeroPetalClick={handlePetalClick}
          heroActiveDim={activeDim}
          heroCenterOverlay={centerOverlay}
          heroWideOverlay={wideOverlay}
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
