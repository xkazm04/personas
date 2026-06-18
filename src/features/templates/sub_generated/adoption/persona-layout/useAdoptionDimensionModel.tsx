// Shared orchestration for the adoption "persona layout" surface.
//
// Extracted from PersonaLayoutAdoptionBaseline so the directional prototype
// variants render the SAME mechanism (petal states, question filtering, picker
// modals, gating) and only differ in their sidebars / header / editor UX. The
// baseline keeps its own inline copy as the untouched A/B reference; if a
// variant wins, consolidation collapses onto this hook.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import { toDisplayUseCase, type DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { updateBuildSessionDisabledDims } from '@/api/agents/buildSession';
import { silentCatch } from '@/lib/silentCatch';
import { getConnectorMeta } from '@/lib/connectors/connectorMeta';
import { scheduleLabelFromSelection, resolveChannelCard } from './adoptionDimHelpers';
import {
  composerScheduleToTriggerSelection,
  triggerSelectionToComposerSchedule,
} from './composerScheduleToTriggerSelection';
import { ComposerSchedulePickerModal } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerSchedulePickerModal';
import { ComposerEventPickerModal } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerEventPickerModal';
import { ComposerConnectorsPickerModal } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerConnectorsPickerModal';
import { ComposerMessagingPickerModal } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerMessagingPickerModal';
import type { ChannelSpecV2 } from '@/lib/bindings/ChannelSpecV2';
import { groupQuestionsByDimension, questionToDimension } from './questionDimMap';
import { buildDimImpacts, type DimImpact } from './adoptionImpact';
import type { AdoptionConnectorCard } from './AdoptionLeftPanel';
import { AdoptionAnswerCard } from './AdoptionAnswerCard';
import { ErrorPolicyCard } from './ErrorPolicyCard';
import type { PersonaLayoutAdoptionModelProps } from './personaLayoutAdoptionTypes';

const POLICY_TOGGLE_DIMS = new Set<GlyphDimension>(['memory', 'review']);
const BUILT_IN_INBOX: ChannelSpecV2 = {
  type: 'built-in', enabled: true, credential_id: null, use_case_ids: '*', event_filter: null, config: null,
};

export interface AdoptionDimensionModel {
  items: DisplayUseCase[];
  activeCapabilityId: string | null;
  activeUc: DisplayUseCase | null;
  setActiveCapabilityId: (id: string) => void;
  activeDim: GlyphDimension | null;
  setActiveDim: React.Dispatch<React.SetStateAction<GlyphDimension | null>>;
  activeQuestionId: string | null;
  setActiveQuestionId: (id: string | null) => void;
  perCapability: Array<{ id: string; title: string; total: number; answered: number; blocked: number; enabled: boolean; segments: Array<'answered' | 'blocked' | 'pending'> }>;
  petalStates: Record<GlyphDimension, PetalState>;
  questionsByDim: Record<GlyphDimension, TransformQuestionResponse[]>;
  filteredQuestions: TransformQuestionResponse[];
  dimImpacts: DimImpact[];
  connectorsForActive: AdoptionConnectorCard[];
  channelsForActive: AdoptionConnectorCard[];
  answeredCount: number;
  totalCount: number;
  globalRemaining: number;
  globalBlocked: number;
  canContinue: boolean;
  activeStoryIdx: number;
  disabledDimsForActive: Set<GlyphDimension>;
  dimOnForCap: (capId: string, dim: 'memory' | 'review') => boolean;
  handlePetalClick: (dim: GlyphDimension) => void;
  handleStoryJumpTo: (idx: number) => void;
  handleActiveCapChange: (id: string) => void;
  openFirstUnanswered: () => void;
  toggleDimDisabled: (dim: GlyphDimension, nextActive: boolean) => void;
  /** The 4 Composer picker modals, fully wired (identical across variants). */
  pickerModals: ReactNode;
  /** Consistent inline editor overlay (AnswerCard / ErrorPolicyCard). */
  wideOverlay: ReactNode;
  /** Sigil-center control: continue / open-questions count / blocked reason. */
  centerOverlay: ReactNode;
  dimLabels: Record<GlyphDimension, string>;
}

export function useAdoptionDimensionModel(props: PersonaLayoutAdoptionModelProps): AdoptionDimensionModel {
  const {
    designResult, templateName, questions, userAnswers, onAnswerUpdated, selectedUseCaseIds, blockedQuestionIds,
    autoDetectedIds, filteredOptions, dynamicOptions, onRetryDynamic, onAddCredential, useCaseTitleById,
    triggerSelections, onTriggerChange, eventSubsByCap, onEventSubsChange,
    dimPolicyByCap, onDimPolicyChange, manualConnectors, onManualConnectorsChange,
    connectorTables, onConnectorTablesChange, notificationChannels, onNotificationChannelsChange,
    errorPolicyByCap, onErrorPolicyChange, onContinue,
  } = props;
  const { t, tx } = useTranslation();
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [activeCapabilityId, setActiveCapabilityId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [messagingOpen, setMessagingOpen] = useState(false);

  const [disabledDimsByCap, setDisabledDimsByCap] = useState<Record<string, Set<GlyphDimension>>>({});
  const sessionId = useAgentStore((s) => s.buildSessionId);
  const sessionDisabledDims = useAgentStore((s) => s.activeBuildSessionId
    ? (s.buildSessions[s.activeBuildSessionId] as unknown as { disabledDims?: Record<string, string[]> } | undefined)?.disabledDims
    : undefined);
  useEffect(() => {
    if (!sessionDisabledDims) { setDisabledDimsByCap({}); return; }
    try {
      const next: Record<string, Set<GlyphDimension>> = {};
      for (const [capId, dims] of Object.entries(sessionDisabledDims)) {
        if (Array.isArray(dims)) next[capId] = new Set(dims as GlyphDimension[]);
      }
      setDisabledDimsByCap(next);
    } catch { setDisabledDimsByCap({}); }
  }, [sessionDisabledDims]);

  const disabledDimsForActive = useMemo(() => {
    if (!activeCapabilityId) return new Set<GlyphDimension>();
    return disabledDimsByCap[activeCapabilityId] ?? new Set<GlyphDimension>();
  }, [activeCapabilityId, disabledDimsByCap]);

  const toggleDimDisabled = useCallback((dim: GlyphDimension, nextActive: boolean) => {
    if (!activeCapabilityId || !sessionId) return;
    setDisabledDimsByCap((prev) => {
      const cur = new Set(prev[activeCapabilityId] ?? []);
      if (nextActive) cur.delete(dim); else cur.add(dim);
      const next = { ...prev, [activeCapabilityId]: cur };
      const wire: Record<string, GlyphDimension[]> = {};
      for (const [capId, set] of Object.entries(next)) if (set.size > 0) wire[capId] = [...set];
      const json = Object.keys(wire).length > 0 ? JSON.stringify(wire) : null;
      void updateBuildSessionDisabledDims(sessionId, json).catch(silentCatch('useAdoptionDimensionModel:toggleDimDisabled'));
      return next;
    });
  }, [activeCapabilityId, sessionId]);

  const items = useMemo<DisplayUseCase[]>(() => {
    const raw = ((designResult?.use_cases ?? []) as unknown[]) as DesignUseCase[];
    return raw.map((uc) => {
      const id = String((uc as { id?: unknown }).id ?? '').trim();
      if (!id) return null;
      const enabled = selectedUseCaseIds.has(id);
      return toDisplayUseCase({ ...uc, id, enabled } as DesignUseCase);
    }).filter((u): u is DisplayUseCase => u !== null);
  }, [designResult, selectedUseCaseIds]);

  useEffect(() => {
    if (items.length === 0) { setActiveCapabilityId(null); return; }
    if (!activeCapabilityId || !items.some((u) => u.id === activeCapabilityId)) {
      setActiveCapabilityId(items[0]!.id);
    }
  }, [items, activeCapabilityId]);

  const capDimsWithQuestions = useMemo(() => {
    const s = new Set<string>();
    for (const q of questions) {
      const ucId = (q as { use_case_id?: string }).use_case_id;
      if (!ucId) continue;
      s.add(`${ucId}:${questionToDimension(q)}`);
    }
    return s;
  }, [questions]);

  const templateDimOn = useCallback((capId: string, dim: 'memory' | 'review') => {
    const uc = items.find((u) => u.id === capId);
    if (uc?.dimensions.includes(dim)) return true;
    return capDimsWithQuestions.has(`${capId}:${dim}`);
  }, [items, capDimsWithQuestions]);

  const dimOnForCap = useCallback((capId: string, dim: 'memory' | 'review') => {
    const explicit = dimPolicyByCap[capId]?.[dim];
    if (explicit !== undefined) return explicit;
    return templateDimOn(capId, dim);
  }, [dimPolicyByCap, templateDimOn]);

  const isQuestionDimOff = useCallback((q: TransformQuestionResponse) => {
    const dim = questionToDimension(q);
    if (dim !== 'memory' && dim !== 'review') return false;
    const ucId = (q as { use_case_id?: string }).use_case_id;
    if (!ucId) return false;
    return !dimOnForCap(ucId, dim);
  }, [dimOnForCap]);

  const filteredQuestions = useMemo(() => questions.filter((q) => {
    const ucId = (q as { use_case_id?: string }).use_case_id;
    const dim = (q as { dimension?: string }).dimension;
    if (ucId && activeCapabilityId && items.length > 1 && ucId !== activeCapabilityId) return false;
    if (ucId && dim) {
      const dis = disabledDimsByCap[ucId];
      if (dis && dis.has(dim as GlyphDimension)) return false;
    }
    if (isQuestionDimOff(q)) return false;
    return true;
  }), [questions, activeCapabilityId, items.length, disabledDimsByCap, isQuestionDimOff]);

  const questionsByDim = useMemo(() => groupQuestionsByDimension(filteredQuestions), [filteredQuestions]);

  const petalStates = useMemo<Record<GlyphDimension, PetalState>>(() => {
    const designDims = new Set<GlyphDimension>();
    for (const uc of items) {
      if (uc.health === 'disabled') continue;
      for (const d of uc.dimensions) designDims.add(d);
    }
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      if (dim === 'error') { out[dim] = 'resolved'; continue; }
      if ((dim === 'memory' || dim === 'review') && activeCapabilityId && !dimOnForCap(activeCapabilityId, dim)) { out[dim] = 'idle'; continue; }
      if (dim === 'trigger') {
        const sel = activeCapabilityId ? triggerSelections[activeCapabilityId] : undefined;
        if (sel?.time || sel?.customCron) { out[dim] = 'resolved'; continue; }
      }
      if (dim === 'event') {
        const subs = activeCapabilityId ? eventSubsByCap[activeCapabilityId] : undefined;
        const sel = activeCapabilityId ? triggerSelections[activeCapabilityId] : undefined;
        if ((subs?.length ?? 0) > 0 || sel?.event) { out[dim] = 'resolved'; continue; }
      }
      if (dim === 'connector' && manualConnectors.length > 0) { out[dim] = 'resolved'; continue; }
      if (dim === 'message' && notificationChannels !== null) {
        out[dim] = notificationChannels.length > 0 ? 'resolved' : 'idle';
        continue;
      }
      if (disabledDimsForActive.has(dim)) { out[dim] = 'idle'; continue; }
      const dimQuestions = questionsByDim[dim];
      const hasUnanswered = dimQuestions.some((q) => !userAnswers[q.id] && !blockedQuestionIds.has(q.id));
      const hasBlocked = dimQuestions.some((q) => blockedQuestionIds.has(q.id));
      if (hasUnanswered || hasBlocked) out[dim] = 'pending';
      else if (dimQuestions.length > 0 || designDims.has(dim)) out[dim] = 'resolved';
      else out[dim] = 'idle';
    }
    return out;
  }, [items, questionsByDim, userAnswers, blockedQuestionIds, disabledDimsForActive, activeCapabilityId, dimOnForCap, triggerSelections, eventSubsByCap, manualConnectors, notificationChannels]);

  const handlePetalClick = useCallback((dim: GlyphDimension) => {
    if (dim === 'trigger') { setScheduleOpen(true); return; }
    if (dim === 'event') { setEventsOpen(true); return; }
    if (dim === 'memory' || dim === 'review') {
      if (!activeCapabilityId) return;
      onDimPolicyChange(activeCapabilityId, dim, !dimOnForCap(activeCapabilityId, dim));
      return;
    }
    if (dim === 'connector' && questionsByDim.connector.length === 0) { setConnectorsOpen(true); return; }
    if (dim === 'message') { setMessagingOpen(true); return; }
    setActiveQuestionId(null);
    setActiveDim((prev) => (prev === dim ? null : dim));
  }, [activeCapabilityId, dimOnForCap, onDimPolicyChange, questionsByDim]);

  const handleStoryJumpTo = useCallback((idx: number) => {
    const q = filteredQuestions[idx];
    if (!q) return;
    setActiveDim(questionToDimension(q));
    setActiveQuestionId(q.id);
  }, [filteredQuestions]);

  const handleActiveCapChange = useCallback((id: string) => {
    setActiveCapabilityId(id); setActiveDim(null); setActiveQuestionId(null);
  }, []);

  const answeredCount = useMemo(() => filteredQuestions.filter((q) => !!userAnswers[q.id]).length, [filteredQuestions, userAnswers]);
  const totalCount = filteredQuestions.length;

  const matchesCap = useCallback((q: TransformQuestionResponse, capId: string) => {
    const ucId = (q as { use_case_id?: string }).use_case_id;
    const dim = (q as { dimension?: string }).dimension;
    if (ucId && items.length > 1 && ucId !== capId) return false;
    if (ucId && dim) {
      const dis = disabledDimsByCap[ucId];
      if (dis && dis.has(dim as GlyphDimension)) return false;
    }
    if (isQuestionDimOff(q)) return false;
    return true;
  }, [items.length, disabledDimsByCap, isQuestionDimOff]);

  const perCapability = useMemo(() => items.map((uc) => {
    const capQs = questions.filter((q) => matchesCap(q, uc.id));
    let answered = 0, blocked = 0;
    const segments = capQs.map((q) => {
      if (userAnswers[q.id]) { answered++; return 'answered' as const; }
      if (blockedQuestionIds.has(q.id)) { blocked++; return 'blocked' as const; }
      return 'pending' as const;
    });
    return { id: uc.id, title: uc.title, total: capQs.length, answered, blocked, enabled: selectedUseCaseIds.has(uc.id), segments };
  }), [items, questions, matchesCap, userAnswers, blockedQuestionIds, selectedUseCaseIds]);

  const gatedQuestions = useMemo(() => questions.filter((q) => {
    if ((q as { optional?: boolean }).optional) return false;
    const ucId = (q as { use_case_id?: string }).use_case_id;
    const dim = (q as { dimension?: string }).dimension;
    if (ucId && dim) {
      const dis = disabledDimsByCap[ucId];
      if (dis && dis.has(dim as GlyphDimension)) return false;
    }
    if (isQuestionDimOff(q)) return false;
    return true;
  }), [questions, disabledDimsByCap, isQuestionDimOff]);
  const globalRemaining = useMemo(() => gatedQuestions.filter((q) => !userAnswers[q.id]).length, [gatedQuestions, userAnswers]);
  const globalBlocked = useMemo(() => gatedQuestions.filter((q) => blockedQuestionIds.has(q.id) && !userAnswers[q.id]).length, [gatedQuestions, blockedQuestionIds, userAnswers]);
  const canContinue = globalRemaining === 0 && globalBlocked === 0 && (items.length === 0 || selectedUseCaseIds.size > 0);

  const activeStoryIdx = useMemo(() => {
    if (!activeDim) return -1;
    if (activeQuestionId) {
      const exact = filteredQuestions.findIndex((q) => q.id === activeQuestionId);
      if (exact >= 0) return exact;
    }
    return filteredQuestions.findIndex((q) => questionToDimension(q) === activeDim);
  }, [filteredQuestions, activeDim, activeQuestionId]);

  const openFirstUnanswered = useCallback(() => {
    const next = gatedQuestions.find((q) => !userAnswers[q.id]);
    if (!next) return;
    const ucId = (next as { use_case_id?: string }).use_case_id;
    if (ucId && ucId !== activeCapabilityId && items.some((u) => u.id === ucId)) setActiveCapabilityId(ucId);
    setActiveDim(questionToDimension(next));
    setActiveQuestionId(next.id);
  }, [gatedQuestions, userAnswers, activeCapabilityId, items]);

  const dimLabels = useMemo<Record<GlyphDimension, string>>(() => ({
    trigger: t.templates.chronology.dim_trigger,
    task: t.templates.chronology.dim_task,
    connector: t.templates.chronology.dim_apps,
    message: t.templates.chronology.dim_messages,
    review: t.templates.chronology.dim_human_review,
    memory: t.templates.chronology.dim_memory,
    event: t.templates.chronology.dim_events,
    error: t.templates.chronology.dim_error_handling,
  }), [t]);

  const connectorsForActive = useMemo<AdoptionConnectorCard[]>(() => {
    const out: AdoptionConnectorCard[] = [];
    const seen = new Set<string>();
    const uc = items.find((u) => u.id === activeCapabilityId);
    if (uc?.connectorKey) { out.push({ key: uc.connectorKey, label: uc.connector }); seen.add(uc.connectorKey.toLowerCase()); }
    for (const name of manualConnectors) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key: name, label: getConnectorMeta(name).label });
    }
    return out;
  }, [items, activeCapabilityId, manualConnectors]);

  const channelsForActive = useMemo<AdoptionConnectorCard[]>(() => {
    if (!notificationChannels) return [];
    const out: AdoptionConnectorCard[] = [];
    const seen = new Set<string>();
    for (const ch of notificationChannels) {
      const card = resolveChannelCard(ch);
      const k = `${card.key}:${ch.credential_id ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(card);
    }
    return out;
  }, [notificationChannels]);

  const answeredByDim = useMemo<Partial<Record<GlyphDimension, string[]>>>(() => {
    const byDim: Partial<Record<GlyphDimension, string[]>> = {};
    for (const q of filteredQuestions) {
      const ans = userAnswers[q.id];
      if (!ans) continue;
      const dim = questionToDimension(q);
      (byDim[dim] ??= []).push(ans);
    }
    return byDim;
  }, [filteredQuestions, userAnswers]);

  const dimImpacts = useMemo<DimImpact[]>(() => buildDimImpacts({
    scheduleLabel: activeCapabilityId ? scheduleLabelFromSelection(triggerSelections[activeCapabilityId], t, tx) : null,
    memoryOn: activeCapabilityId ? dimOnForCap(activeCapabilityId, 'memory') : false,
    memoryRelevant: activeCapabilityId ? (dimPolicyByCap[activeCapabilityId]?.memory !== undefined || templateDimOn(activeCapabilityId, 'memory')) : false,
    reviewOn: activeCapabilityId ? dimOnForCap(activeCapabilityId, 'review') : false,
    reviewRelevant: activeCapabilityId ? (dimPolicyByCap[activeCapabilityId]?.review !== undefined || templateDimOn(activeCapabilityId, 'review')) : false,
    reviewMode: (items.find((u) => u.id === activeCapabilityId) as unknown as { review_policy?: { mode?: string } } | undefined)?.review_policy?.mode ?? null,
    eventCount: activeCapabilityId ? (eventSubsByCap[activeCapabilityId]?.length ?? 0) : 0,
    connectorLabels: connectorsForActive.map((c) => c.label),
    channelLabels: channelsForActive.map((c) => c.label),
    channelsTouched: notificationChannels !== null,
    errorPolicy: activeCapabilityId ? errorPolicyByCap?.[activeCapabilityId] : undefined,
    answeredByDim,
    dimLabels,
  }), [activeCapabilityId, triggerSelections, t, tx, dimOnForCap, dimPolicyByCap, templateDimOn, items, eventSubsByCap, connectorsForActive, channelsForActive, notificationChannels, errorPolicyByCap, answeredByDim, dimLabels]);

  const activeUc = items.find((u) => u.id === activeCapabilityId) ?? null;
  const activeCapTitle = activeUc?.title ?? templateName;

  // Shared editor overlay — ONE consistent surface for every petal that edits
  // inline (task / connector-with-questions / error). Picker dims (trigger /
  // event / connector / message) use the modals; memory/review toggle in place.
  // Consolidating the editor here is the "consistent per-petal UX" fix.
  const wideOverlay: ReactNode = activeDim === 'error' ? (
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
        if (POLICY_TOGGLE_DIMS.has(activeDim) && activeCapabilityId) onDimPolicyChange(activeCapabilityId, activeDim as 'memory' | 'review', next);
        else toggleDimDisabled(activeDim, next);
      }}
      onClose={() => { setActiveDim(null); setActiveQuestionId(null); }}
    />
  ) : undefined;

  const continueDisabledReason = !canContinue
    ? globalBlocked > 0
      ? tx(t.templates.adopt_modal.persona_layout_continue_blocked, { count: globalBlocked })
      : globalRemaining > 0
        ? tx(t.templates.adopt_modal.persona_layout_continue_remaining, { count: globalRemaining })
        : selectedUseCaseIds.size === 0
          ? t.templates.adopt_modal.persona_layout_continue_no_capabilities
          : null
    : null;

  const centerOverlay: ReactNode = activeDim ? (
    <span aria-hidden />
  ) : canContinue ? (
    <button type="button" onClick={onContinue} data-testid="adopt-continue-to-build"
      className="pointer-events-auto group flex flex-col items-center gap-1.5 px-6 py-3 rounded-modal bg-primary/20 hover:bg-primary/35 border border-primary/45 hover:border-primary/70 text-foreground cursor-pointer transition-all"
      title={t.templates.adopt_modal.persona_layout_continue_to_build}>
      <ChevronRight className="w-5 h-5 text-primary" />
      <span className="typo-label uppercase tracking-[0.18em] text-foreground">{t.templates.adopt_modal.persona_layout_continue_to_build}</span>
    </button>
  ) : globalRemaining > 0 ? (
    <button type="button" onClick={openFirstUnanswered}
      className="pointer-events-auto group flex flex-col items-center gap-1.5 px-5 py-3 rounded-modal bg-status-warning/10 hover:bg-status-warning/20 border border-status-warning/40 hover:border-status-warning/65 text-foreground cursor-pointer transition-all"
      title={t.templates.adopt_modal.persona_layout_center_open_questions_title}>
      <span className="typo-data font-mono text-2xl text-status-warning tabular-nums leading-none">{globalRemaining}</span>
      <span className="typo-label uppercase tracking-[0.18em] text-foreground/85">{globalRemaining === 1 ? t.templates.adopt_modal.persona_layout_center_questions_to_answer_one : t.templates.adopt_modal.persona_layout_center_questions_to_answer_other}</span>
      <span className="typo-caption text-foreground italic group-hover:text-foreground/80 transition-colors">{t.templates.adopt_modal.persona_layout_center_click_to_start}</span>
    </button>
  ) : continueDisabledReason ? (
    <span className="typo-caption text-status-warning italic pointer-events-none inline-flex items-center gap-1.5 max-w-[14rem] text-center">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />{continueDisabledReason}
    </span>
  ) : (<span aria-hidden />);

  const composerSchedule = triggerSelectionToComposerSchedule(activeCapabilityId ? triggerSelections[activeCapabilityId] : undefined);

  const pickerModals = (
    <>
      <ComposerSchedulePickerModal
        open={scheduleOpen} onClose={() => setScheduleOpen(false)}
        frequency={composerSchedule.frequency} days={composerSchedule.days}
        monthDay={composerSchedule.monthDay} time={composerSchedule.time}
        onApply={(next) => {
          if (activeCapabilityId) onTriggerChange(activeCapabilityId, composerScheduleToTriggerSelection(next, triggerSelections[activeCapabilityId]));
          setScheduleOpen(false);
        }}
      />
      <ComposerEventPickerModal
        open={eventsOpen} onClose={() => setEventsOpen(false)}
        selected={activeCapabilityId ? (eventSubsByCap[activeCapabilityId] ?? []) : []}
        onApply={(next) => { if (activeCapabilityId) onEventSubsChange(activeCapabilityId, next); setEventsOpen(false); }}
      />
      <ComposerConnectorsPickerModal
        open={connectorsOpen} onClose={() => setConnectorsOpen(false)}
        selected={manualConnectors} tables={connectorTables}
        onApply={(next, nextTables) => { onManualConnectorsChange(next); onConnectorTablesChange(nextTables); setConnectorsOpen(false); }}
      />
      <ComposerMessagingPickerModal
        open={messagingOpen} onClose={() => setMessagingOpen(false)}
        selected={notificationChannels ?? [BUILT_IN_INBOX]} pinBuiltIn={false}
        onApply={(next) => { onNotificationChannelsChange(next); setMessagingOpen(false); }}
      />
    </>
  );

  return {
    items, activeCapabilityId, activeUc, setActiveCapabilityId,
    activeDim, setActiveDim, activeQuestionId, setActiveQuestionId,
    perCapability, petalStates, questionsByDim, filteredQuestions, dimImpacts,
    connectorsForActive, channelsForActive, answeredCount, totalCount,
    globalRemaining, globalBlocked, canContinue, activeStoryIdx, disabledDimsForActive,
    dimOnForCap, handlePetalClick, handleStoryJumpTo, handleActiveCapChange,
    openFirstUnanswered, toggleDimDisabled, pickerModals, wideOverlay, centerOverlay, dimLabels,
  };
}

export { POLICY_TOGGLE_DIMS };
