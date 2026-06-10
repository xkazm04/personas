import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import type { PersonaSigilSummaryEntry } from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import { CapabilityTagSwitcher } from './CapabilityTagSwitcher';
import { AdoptionLeftPanel, type AdoptionConnectorCard } from './AdoptionLeftPanel';
import { scheduleLabelFromSelection } from './adoptionDimHelpers';
import {
  composerScheduleToTriggerSelection,
  triggerSelectionToComposerSchedule,
} from './composerScheduleToTriggerSelection';
import { ComposerSchedulePickerModal } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerSchedulePickerModal';
import { ComposerEventPickerModal } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerEventPickerModal';
import type { EventSubscription } from '@/features/agents/shared/quickConfig/quickConfigTypes';
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
import type { DesignUseCase, UseCaseErrorPolicy } from '@/lib/types/frontendTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { TriggerSelection } from '../useCasePickerShared';

/** Loose template design-result shape. The n8n transform's output doesn't
 *  conform to the strict `AgentIR` interface (use_cases lives at the top
 *  level here, not under design_context), so callers pass a Record. */
type TemplateDesignResult = Record<string, unknown>;
import { QuestionnaireStoryThread } from '../questionnaire/QuestionnaireStoryThread';
import type { DynamicOptionState } from '../useDynamicQuestionOptions';
import { AdoptionAnswerCard } from './AdoptionAnswerCard';
import { ErrorPolicyCard } from './ErrorPolicyCard';
import { groupQuestionsByDimension, questionToDimension } from './questionDimMap';

/** Dims that toggle on/off directly on petal click (no card / picker). */
const POLICY_TOGGLE_DIMS = new Set<GlyphDimension>(['memory', 'review']);

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
  /** Per-capability "Errors" sigil routing policy (capability id → policy). */
  errorPolicyByCap?: Record<string, UseCaseErrorPolicy>;
  /** Persist a capability's error-routing policy (lifted to the parent so it
   *  rides onto the design IR at seed time). */
  onErrorPolicyChange?: (capabilityId: string, policy: UseCaseErrorPolicy) => void;

  // ---- Editable dimensions (glyph-builder parity) ----------------------
  /** Per-capability trigger ("When") selections. Drives the schedule petal. */
  triggerSelections: Record<string, TriggerSelection>;
  /** Set a capability's trigger selection (from the schedule picker). */
  onTriggerChange: (capabilityId: string, sel: TriggerSelection) => void;
  /** Per-capability cross-persona event subscriptions (the Events petal). */
  eventSubsByCap: Record<string, EventSubscription[]>;
  /** Set a capability's event subscriptions (from the event picker). */
  onEventSubsChange: (capabilityId: string, subs: EventSubscription[]) => void;
  /** Per-capability Memory/Review on-off overrides (undefined = template default). */
  dimPolicyByCap: Record<string, { memory?: boolean; review?: boolean }>;
  /** Toggle a capability's Memory/Review on-off (petal click). */
  onDimPolicyChange: (capabilityId: string, dim: 'memory' | 'review', on: boolean) => void;
}

/**
 * Persona Layout adoption surface. One screen replaces the picker +
 * questionnaire steps, with every dimension directly editable on the sigil:
 *   • Capability tags (top) — select + include/skip toggle; active tag's
 *     description renders below. This is the only capability control (the
 *     old bottom row-list is gone).
 *   • Hero — Persona Sigil. Petal routing:
 *       trigger → schedule picker · event → cross-persona event picker
 *       memory / review → on/off toggle on click
 *       task / connector / message → inline answer card · error → policy card
 *   • Left — always-on AdoptionLeftPanel (connector card + value summary),
 *     so the hero never re-centers between empty / filled states.
 *   • Right — QuestionnaireStoryThread.
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
  errorPolicyByCap,
  onErrorPolicyChange,
  triggerSelections,
  onTriggerChange,
  eventSubsByCap,
  onEventSubsChange,
  dimPolicyByCap,
  onDimPolicyChange,
}: PersonaLayoutAdoptionProps) {
  const { t, tx } = useTranslation();
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [activeCapabilityId, setActiveCapabilityId] = useState<string | null>(null);

  // Reused-from-glyph-builder picker modals (open over the adoption modal).
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  // Per-capability disabled-dims map — drives question filtering + petal idle
  // for the CARD dims (task / connector / message) via the AnswerCard footer
  // toggle. Memory/Review use the explicit `dimPolicyByCap` instead (so they
  // can be forced ON even for templates that didn't ship them).
  const [disabledDimsByCap, setDisabledDimsByCap] = useState<Record<string, Set<GlyphDimension>>>({});
  const sessionId = useAgentStore((s) => s.buildSessionId);
  const sessionDisabledDims = useAgentStore((s) => s.activeBuildSessionId
    ? (s.buildSessions[s.activeBuildSessionId] as unknown as { disabledDims?: Record<string, string[]> } | undefined)?.disabledDims
    : undefined);
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

  useEffect(() => {
    if (items.length === 0) {
      setActiveCapabilityId(null);
      return;
    }
    if (!activeCapabilityId || !items.some((u) => u.id === activeCapabilityId)) {
      setActiveCapabilityId(items[0]!.id);
    }
  }, [items, activeCapabilityId]);

  // Caps that ship at least one question per dim — feeds the Memory/Review
  // template-default (a question on a dim means the template intends it ON).
  const capDimsWithQuestions = useMemo(() => {
    const s = new Set<string>();
    for (const q of questions) {
      const ucId = (q as { use_case_id?: string }).use_case_id;
      if (!ucId) continue;
      s.add(`${ucId}:${questionToDimension(q)}`);
    }
    return s;
  }, [questions]);

  // Template-default ON for a Memory/Review dim on a capability.
  const templateDimOn = useCallback(
    (capId: string, dim: 'memory' | 'review') => {
      const uc = items.find((u) => u.id === capId);
      if (uc?.dimensions.includes(dim)) return true;
      return capDimsWithQuestions.has(`${capId}:${dim}`);
    },
    [items, capDimsWithQuestions],
  );

  // Resolved Memory/Review on-off for a capability (explicit override wins).
  const dimOnForCap = useCallback(
    (capId: string, dim: 'memory' | 'review') => {
      const explicit = dimPolicyByCap[capId]?.[dim];
      if (explicit !== undefined) return explicit;
      return templateDimOn(capId, dim);
    },
    [dimPolicyByCap, templateDimOn],
  );

  // True when a question's dim is switched OFF for its capability (Memory/
  // Review policy). Drives question filtering + gating so an off dim's
  // questions neither show nor block.
  const isQuestionDimOff = useCallback(
    (q: TransformQuestionResponse) => {
      const dim = questionToDimension(q);
      if (dim !== 'memory' && dim !== 'review') return false;
      const ucId = (q as { use_case_id?: string }).use_case_id;
      if (!ucId) return false;
      return !dimOnForCap(ucId, dim);
    },
    [dimOnForCap],
  );

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      const ucId = (q as { use_case_id?: string }).use_case_id;
      const dim = (q as { dimension?: string }).dimension;
      if (ucId && activeCapabilityId && items.length > 1 && ucId !== activeCapabilityId) {
        return false;
      }
      if (ucId && dim) {
        const dis = disabledDimsByCap[ucId];
        if (dis && dis.has(dim as GlyphDimension)) return false;
      }
      if (isQuestionDimOff(q)) return false;
      return true;
    });
  }, [questions, activeCapabilityId, items.length, disabledDimsByCap, isQuestionDimOff]);

  const questionsByDim = useMemo(
    () => groupQuestionsByDimension(filteredQuestions),
    [filteredQuestions],
  );

  const petalStates = useMemo<Record<GlyphDimension, PetalState>>(() => {
    const designDims = new Set<GlyphDimension>();
    for (const uc of items) {
      if (uc.health === 'disabled') continue;
      for (const d of uc.dimensions) designDims.add(d);
    }

    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      // Error handling is always a built-in — petal stays resolved + clickable
      // to configure post-error routing.
      if (dim === 'error') {
        out[dim] = 'resolved';
        continue;
      }
      // Memory / Review switched OFF → idle (off), regardless of questions.
      if ((dim === 'memory' || dim === 'review') && activeCapabilityId && !dimOnForCap(activeCapabilityId, dim)) {
        out[dim] = 'idle';
        continue;
      }
      // When / Events with a user selection → resolved (lit).
      if (dim === 'trigger') {
        const sel = activeCapabilityId ? triggerSelections[activeCapabilityId] : undefined;
        if (sel?.time || sel?.customCron) { out[dim] = 'resolved'; continue; }
      }
      if (dim === 'event') {
        const subs = activeCapabilityId ? eventSubsByCap[activeCapabilityId] : undefined;
        const sel = activeCapabilityId ? triggerSelections[activeCapabilityId] : undefined;
        if ((subs?.length ?? 0) > 0 || sel?.event) { out[dim] = 'resolved'; continue; }
      }
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
  }, [items, questionsByDim, userAnswers, blockedQuestionIds, disabledDimsForActive, activeCapabilityId, dimOnForCap, triggerSelections, eventSubsByCap]);

  const handlePetalClick = useCallback(
    (dim: GlyphDimension) => {
      // When / Events → reuse the from-scratch builder's pickers.
      if (dim === 'trigger') { setScheduleOpen(true); return; }
      if (dim === 'event') { setEventsOpen(true); return; }
      // Memory / Review → toggle on/off in place (no card).
      if (dim === 'memory' || dim === 'review') {
        if (!activeCapabilityId) return;
        onDimPolicyChange(activeCapabilityId, dim, !dimOnForCap(activeCapabilityId, dim));
        return;
      }
      // task / connector / message / error → open the inline card.
      setActiveQuestionId(null);
      setActiveDim((prev) => (prev === dim ? null : dim));
    },
    [activeCapabilityId, dimOnForCap, onDimPolicyChange],
  );

  const handleStoryJumpTo = useCallback(
    (idx: number) => {
      const q = filteredQuestions[idx];
      if (!q) return;
      setActiveDim(questionToDimension(q));
      setActiveQuestionId(q.id);
    },
    [filteredQuestions],
  );

  const answeredCount = useMemo(
    () => filteredQuestions.filter((q) => !!userAnswers[q.id]).length,
    [filteredQuestions, userAnswers],
  );
  const totalCount = filteredQuestions.length;

  const matchesCap = useCallback(
    (q: TransformQuestionResponse, capId: string) => {
      const ucId = (q as { use_case_id?: string }).use_case_id;
      const dim = (q as { dimension?: string }).dimension;
      if (ucId && items.length > 1 && ucId !== capId) return false;
      if (ucId && dim) {
        const dis = disabledDimsByCap[ucId];
        if (dis && dis.has(dim as GlyphDimension)) return false;
      }
      if (isQuestionDimOff(q)) return false;
      return true;
    },
    [items.length, disabledDimsByCap, isQuestionDimOff],
  );

  // One tag per capability: title + answered/total + per-question segments
  // + include/skip state.
  const perCapability = useMemo(
    () =>
      items.map((uc) => {
        const capQs = questions.filter((q) => matchesCap(q, uc.id));
        let answered = 0;
        let blocked = 0;
        const segments = capQs.map((q) => {
          if (userAnswers[q.id]) { answered++; return 'answered' as const; }
          if (blockedQuestionIds.has(q.id)) { blocked++; return 'blocked' as const; }
          return 'pending' as const;
        });
        return {
          id: uc.id,
          title: uc.title,
          total: capQs.length,
          answered,
          blocked,
          enabled: selectedUseCaseIds.has(uc.id),
          segments,
        };
      }),
    [items, questions, matchesCap, userAnswers, blockedQuestionIds, selectedUseCaseIds],
  );

  const gatedQuestions = useMemo(
    () =>
      questions.filter((q) => {
        if ((q as { optional?: boolean }).optional) return false;
        const ucId = (q as { use_case_id?: string }).use_case_id;
        const dim = (q as { dimension?: string }).dimension;
        if (ucId && dim) {
          const dis = disabledDimsByCap[ucId];
          if (dis && dis.has(dim as GlyphDimension)) return false;
        }
        if (isQuestionDimOff(q)) return false;
        return true;
      }),
    [questions, disabledDimsByCap, isQuestionDimOff],
  );
  const globalRemaining = useMemo(
    () => gatedQuestions.filter((q) => !userAnswers[q.id]).length,
    [gatedQuestions, userAnswers],
  );
  const globalBlocked = useMemo(
    () => gatedQuestions.filter((q) => blockedQuestionIds.has(q.id) && !userAnswers[q.id]).length,
    [gatedQuestions, blockedQuestionIds, userAnswers],
  );

  const canContinue =
    globalRemaining === 0 &&
    globalBlocked === 0 &&
    (items.length === 0 || selectedUseCaseIds.size > 0);

  const activeStoryIdx = useMemo(() => {
    if (!activeDim) return -1;
    if (activeQuestionId) {
      const exact = filteredQuestions.findIndex((q) => q.id === activeQuestionId);
      if (exact >= 0) return exact;
    }
    return filteredQuestions.findIndex((q) => questionToDimension(q) === activeDim);
  }, [filteredQuestions, activeDim, activeQuestionId]);

  // Summary sidebar entries — answered-question values plus the editable-dim
  // state (Memory/Review on-off, schedule, event count) for the active cap.
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
      if (dim === 'task') continue;
      const list = byDim.get(dim);
      if (list) list.push(ans);
      else byDim.set(dim, [ans]);
    }
    const out: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>> = {};
    for (const [dim, values] of byDim) {
      out[dim] = { label: dimLabels[dim], value: values.join(' · ') };
    }

    // Editable-dim reflection for the active capability.
    if (activeCapabilityId) {
      for (const dim of ['memory', 'review'] as const) {
        const explicit = dimPolicyByCap[activeCapabilityId]?.[dim];
        const relevant = explicit !== undefined || templateDimOn(activeCapabilityId, dim);
        if (!relevant) continue;
        const on = dimOnForCap(activeCapabilityId, dim);
        const stateLabel = on ? t.templates.adopt_modal.policy_on : t.templates.adopt_modal.policy_off;
        const detail = out[dim]?.value;
        out[dim] = {
          label: dimLabels[dim],
          value: on && detail ? `${stateLabel} · ${detail}` : stateLabel,
        };
      }
      const schedLabel = scheduleLabelFromSelection(triggerSelections[activeCapabilityId], t, tx);
      if (schedLabel) out.trigger = { label: dimLabels.trigger, value: schedLabel };
      const subs = eventSubsByCap[activeCapabilityId];
      if (subs && subs.length > 0) {
        out.event = {
          label: dimLabels.event,
          value: tx(
            subs.length === 1
              ? t.templates.adopt_modal.events_count_one
              : t.templates.adopt_modal.events_count_other,
            { count: subs.length },
          ),
        };
      }
    }
    return out;
  }, [filteredQuestions, userAnswers, t, tx, activeCapabilityId, dimPolicyByCap, templateDimOn, dimOnForCap, triggerSelections, eventSubsByCap]);

  // Connector card source — the active capability's primary connector.
  const connectorsForActive = useMemo<AdoptionConnectorCard[]>(() => {
    const uc = items.find((u) => u.id === activeCapabilityId);
    if (uc?.connectorKey) return [{ key: uc.connectorKey, label: uc.connector }];
    return [];
  }, [items, activeCapabilityId]);

  const leftSlot = (
    <AdoptionLeftPanel
      connectors={connectorsForActive}
      summaryEntries={summaryEntries}
      onSelectDim={handlePetalClick}
    />
  );

  const rightSlot = (
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
  );

  const continueDisabledReason = !canContinue
    ? globalBlocked > 0
      ? tx(t.templates.adopt_modal.persona_layout_continue_blocked, { count: globalBlocked })
      : globalRemaining > 0
        ? tx(t.templates.adopt_modal.persona_layout_continue_remaining, { count: globalRemaining })
        : selectedUseCaseIds.size === 0
          ? t.templates.adopt_modal.persona_layout_continue_no_capabilities
          : null
    : null;

  const handleActiveCapChange = useCallback(
    (id: string) => {
      setActiveCapabilityId(id);
      setActiveDim(null);
      setActiveQuestionId(null);
    },
    [],
  );

  const activeUc = items.find((u) => u.id === activeCapabilityId) ?? null;

  // Top slot — the SINGLE capability control: tags (select + include/skip)
  // plus the active capability's description. Replaces the old bottom list.
  const topSlot = items.length > 0 ? (
    <div className="flex flex-col gap-3">
      <CapabilityTagSwitcher
        items={perCapability}
        activeId={activeCapabilityId}
        onActiveChange={handleActiveCapChange}
        onToggleEnabled={onToggleUseCase}
      />
      {activeUc && (
        <div className="rounded-card border border-card-border/50 bg-secondary/15 px-4 py-3">
          <h3 className="typo-body-lg font-medium text-foreground">{activeUc.title}</h3>
          {activeUc.description && (
            <p className="typo-caption text-foreground mt-1 leading-relaxed">{activeUc.description}</p>
          )}
        </div>
      )}
    </div>
  ) : null;

  const openFirstUnanswered = useCallback(() => {
    const next = gatedQuestions.find((q) => !userAnswers[q.id]);
    if (!next) return;
    const ucId = (next as { use_case_id?: string }).use_case_id;
    if (ucId && ucId !== activeCapabilityId && items.some((u) => u.id === ucId)) {
      setActiveCapabilityId(ucId);
    }
    setActiveDim(questionToDimension(next));
    setActiveQuestionId(next.id);
  }, [gatedQuestions, userAnswers, activeCapabilityId, items]);

  const activeCapTitle = activeUc?.title ?? templateName;
  const wideOverlay = activeDim === 'error' ? (
    <ErrorPolicyCard
      capabilityTitle={activeCapTitle}
      policy={activeCapabilityId ? errorPolicyByCap?.[activeCapabilityId] : undefined}
      onChange={(next) => { if (activeCapabilityId) onErrorPolicyChange?.(activeCapabilityId, next); }}
      onClose={() => { setActiveDim(null); setActiveQuestionId(null); }}
    />
  ) : activeDim ? (
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
      isDimActive={
        POLICY_TOGGLE_DIMS.has(activeDim) && activeCapabilityId
          ? dimOnForCap(activeCapabilityId, activeDim as 'memory' | 'review')
          : !disabledDimsForActive.has(activeDim)
      }
      onToggleDim={(next) => {
        if (POLICY_TOGGLE_DIMS.has(activeDim) && activeCapabilityId) {
          onDimPolicyChange(activeCapabilityId, activeDim as 'memory' | 'review', next);
        } else {
          toggleDimDisabled(activeDim, next);
        }
      }}
      onClose={() => {
        setActiveDim(null);
        setActiveQuestionId(null);
      }}
    />
  ) : undefined;

  const unansweredCount = globalRemaining;
  const centerOverlay = activeDim ? (
    <span aria-hidden />
  ) : canContinue ? (
    <button
      type="button"
      onClick={onContinue}
      data-testid="adopt-continue-to-build"
      className="pointer-events-auto group flex flex-col items-center gap-1.5 px-6 py-3 rounded-modal bg-primary/20 hover:bg-primary/35 border border-primary/45 hover:border-primary/70 text-foreground cursor-pointer transition-all"
      title={t.templates.adopt_modal.persona_layout_continue_to_build}
    >
      <ChevronRight className="w-5 h-5 text-primary" />
      <span className="typo-label uppercase tracking-[0.18em] text-foreground">
        {t.templates.adopt_modal.persona_layout_continue_to_build}
      </span>
    </button>
  ) : unansweredCount > 0 ? (
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
      <span className="typo-caption text-foreground italic group-hover:text-foreground/80 transition-colors">
        {t.templates.adopt_modal.persona_layout_center_click_to_start}
      </span>
    </button>
  ) : continueDisabledReason ? (
    <span className="typo-caption text-status-warning italic pointer-events-none inline-flex items-center gap-1.5 max-w-[14rem] text-center">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {continueDisabledReason}
    </span>
  ) : (
    <span aria-hidden />
  );

  const composerSchedule = triggerSelectionToComposerSchedule(
    activeCapabilityId ? triggerSelections[activeCapabilityId] : undefined,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        <PersonaLayout
          mode="adoption"
          personaName={templateName}
          items={items}
          onRowOpen={() => { /* in-card answering covers per-question flow */ }}
          onRowToggle={(uc) => onToggleUseCase(uc.id)}
          topSlot={topSlot}
          leftSlot={leftSlot}
          rightSlot={rightSlot}
          hideMetadataBand
          hideCapabilityRows={items.length > 0}
          sigilSizeScale={0.8}
          heroPetalStatesOverride={petalStates}
          onHeroPetalClick={handlePetalClick}
          heroActiveDim={activeDim}
          heroCenterOverlay={centerOverlay}
          heroWideOverlay={wideOverlay}
          emptyNode={
            <div className="rounded-modal border border-card-border bg-secondary/30 p-8 text-center">
              <span className="typo-body text-foreground italic">
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
          className="typo-caption text-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {t.templates.adopt_modal.cancel}
        </button>
      </div>

      <ComposerSchedulePickerModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        frequency={composerSchedule.frequency}
        days={composerSchedule.days}
        monthDay={composerSchedule.monthDay}
        time={composerSchedule.time}
        onApply={(next) => {
          if (activeCapabilityId) {
            onTriggerChange(
              activeCapabilityId,
              composerScheduleToTriggerSelection(next, triggerSelections[activeCapabilityId]),
            );
          }
          setScheduleOpen(false);
        }}
      />
      <ComposerEventPickerModal
        open={eventsOpen}
        onClose={() => setEventsOpen(false)}
        selected={activeCapabilityId ? (eventSubsByCap[activeCapabilityId] ?? []) : []}
        onApply={(next) => {
          if (activeCapabilityId) onEventSubsChange(activeCapabilityId, next);
          setEventsOpen(false);
        }}
      />
    </div>
  );
}
