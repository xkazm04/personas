import { useCallback } from 'react';
import type { N8nPersonaDraft, TransformQuestionResponse } from '@/api/n8nTransform';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { useWizardReducer } from '@/hooks/useWizardReducer';
import { getAdoptionRequirements, getDefaultValues } from './templateVariables';

// ── Persistence ──

export const ADOPT_CONTEXT_KEY = 'template-adopt-context-v1';

/** Max age for persisted context before it's considered stale (10 minutes) */
export const ADOPT_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

export interface PersistedAdoptContext {
  adoptId: string;
  templateName: string;
  designResultJson: string;
  /** Timestamp when context was persisted (ms since epoch) */
  savedAt: number;
}

// ── Wizard Steps ──

export type AdoptWizardStep = 'choose' | 'connect' | 'tune' | 'build' | 'create';

export const ADOPT_STEPS: readonly AdoptWizardStep[] = [
  'choose',
  'connect',
  'tune',
  'build',
  'create',
] as const;

export const ADOPT_STEP_META: Record<AdoptWizardStep, { label: string; index: number }> = {
  choose:  { label: 'Choose',  index: 0 },
  connect: { label: 'Connect', index: 1 },
  tune:    { label: 'Tune',    index: 2 },
  build:   { label: 'Build',   index: 3 },
  create:  { label: 'Create',  index: 4 },
};

// ── Helpers ──

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function initSelectionsFromDesignResult(design: DesignAnalysisResult) {
  const selectedToolIndices = new Set<number>(
    design.suggested_tools.map((_, i) => i),
  );
  const selectedTriggerIndices = new Set<number>(
    design.suggested_triggers.map((_, i) => i),
  );
  const selectedConnectorNames = new Set<string>(
    (design.suggested_connectors ?? []).map((c) => c.name),
  );
  const selectedChannelIndices = new Set<number>(
    (design.suggested_notification_channels ?? []).map((_, i) => i),
  );
  const selectedEventIndices = new Set<number>(
    (design.suggested_event_subscriptions ?? []).map((_, i) => i),
  );
  const selectedUseCaseIds = new Set<string>();

  const variableValues = getDefaultValues(getAdoptionRequirements(design));

  return {
    selectedUseCaseIds,
    selectedToolIndices,
    selectedTriggerIndices,
    selectedConnectorNames,
    selectedChannelIndices,
    selectedEventIndices,
    variableValues,
  };
}

// ── State ──

export interface AdoptState {
  step: AdoptWizardStep;

  // Template context
  templateName: string;
  reviewId: string;
  designResult: DesignAnalysisResult | null;
  designResultJson: string;

  // Entity selection (Choose step)
  selectedUseCaseIds: Set<string>;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  selectedChannelIndices: Set<number>;
  selectedEventIndices: Set<number>;

  // Template variables (Tune step)
  variableValues: Record<string, string>;

  // Trigger configs (Tune step)
  triggerConfigs: Record<number, Record<string, string>>;

  // AI questions (Tune step)
  questions: TransformQuestionResponse[] | null;
  userAnswers: Record<string, string>;
  questionGenerating: boolean;

  // Connector credential mapping (Connect step)
  connectorCredentialMap: Record<string, string>;
  inlineCredentialConnector: string | null;

  // Transform (Build step)
  transforming: boolean;
  backgroundAdoptId: string | null;
  adjustmentRequest: string;
  transformPhase: CliRunPhase;
  transformLines: string[];

  // Draft
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;

  // Create step
  confirming: boolean;
  created: boolean;
  showEditInline: boolean;
  error: string | null;
}

const INITIAL_STATE: AdoptState = {
  step: 'choose',
  templateName: '',
  reviewId: '',
  designResult: null,
  designResultJson: '',
  selectedUseCaseIds: new Set(),
  selectedToolIndices: new Set(),
  selectedTriggerIndices: new Set(),
  selectedConnectorNames: new Set(),
  selectedChannelIndices: new Set(),
  selectedEventIndices: new Set(),
  variableValues: {},
  triggerConfigs: {},
  questions: null,
  userAnswers: {},
  questionGenerating: false,
  connectorCredentialMap: {},
  inlineCredentialConnector: null,
  transforming: false,
  backgroundAdoptId: null,
  adjustmentRequest: '',
  transformPhase: 'idle',
  transformLines: [],
  draft: null,
  draftJson: '',
  draftJsonError: null,
  confirming: false,
  created: false,
  showEditInline: false,
  error: null,
};

function prefillDefaults(questions: TransformQuestionResponse[]): Record<string, string> {
  return questions.reduce<Record<string, string>>((acc, q) => {
    if (q.default) acc[q.id] = q.default;
    return acc;
  }, {});
}

// ── Hook ──

export function useAdoptReducer() {
  const core = useWizardReducer<AdoptState>({
    initialState: INITIAL_STATE,
    stepMeta: ADOPT_STEP_META,
    canGoBack: (s) => s.step !== 'choose' && !s.transforming && !s.confirming && !s.questionGenerating,
    goBack: (s, goToStep) => {
      if (s.step === 'connect') goToStep('choose');
      else if (s.step === 'tune') goToStep('connect');
      else if (s.step === 'build') goToStep('tune');
      else if (s.step === 'create') {
        if (s.draft) goToStep('build');
        else goToStep('tune');
      }
    },
  });

  const { state, update } = core;

  const init = useCallback((templateName: string, reviewId: string, designResult: DesignAnalysisResult, designResultJson: string) => {
    const selections = initSelectionsFromDesignResult(designResult);
    update({
      ...INITIAL_STATE,
      step: 'choose',
      templateName,
      reviewId,
      designResult,
      designResultJson,
      ...selections,
    });
  }, [update]);

  // ── Entity selection toggles ──

  const toggleUseCaseId = useCallback((id: string) => {
    update({ selectedUseCaseIds: toggleInSet(state.selectedUseCaseIds, id) });
  }, [update, state.selectedUseCaseIds]);

  const toggleTool = useCallback((index: number) => {
    update({ selectedToolIndices: toggleInSet(state.selectedToolIndices, index) });
  }, [update, state.selectedToolIndices]);

  const toggleTrigger = useCallback((index: number) => {
    update({ selectedTriggerIndices: toggleInSet(state.selectedTriggerIndices, index) });
  }, [update, state.selectedTriggerIndices]);

  const toggleConnector = useCallback((name: string) => {
    update({ selectedConnectorNames: toggleInSet(state.selectedConnectorNames, name) });
  }, [update, state.selectedConnectorNames]);

  const toggleChannel = useCallback((index: number) => {
    update({ selectedChannelIndices: toggleInSet(state.selectedChannelIndices, index) });
  }, [update, state.selectedChannelIndices]);

  const toggleEvent = useCallback((index: number) => {
    update({ selectedEventIndices: toggleInSet(state.selectedEventIndices, index) });
  }, [update, state.selectedEventIndices]);

  // ── Variable & trigger config ──

  const updateVariable = useCallback((key: string, value: string) => {
    update({ variableValues: { ...state.variableValues, [key]: value } });
  }, [update, state.variableValues]);

  const updateTriggerConfig = useCallback((triggerIdx: number, config: Record<string, string>) => {
    update({ triggerConfigs: { ...state.triggerConfigs, [triggerIdx]: config } });
  }, [update, state.triggerConfigs]);

  // ── Connector credential mapping (Connect step) ──

  const setConnectorCredential = useCallback((connectorName: string, credentialId: string) => {
    update({ connectorCredentialMap: { ...state.connectorCredentialMap, [connectorName]: credentialId } });
  }, [update, state.connectorCredentialMap]);

  const clearConnectorCredential = useCallback((connectorName: string) => {
    const next = { ...state.connectorCredentialMap };
    delete next[connectorName];
    update({ connectorCredentialMap: next });
  }, [update, state.connectorCredentialMap]);

  const setInlineCredentialConnector = useCallback((name: string | null) => {
    update({ inlineCredentialConnector: name });
  }, [update]);

  // ── Create step ──

  const toggleEditInline = useCallback(() => {
    update({ showEditInline: !state.showEditInline });
  }, [update, state.showEditInline]);

  // ── Existing actions ──

  const questionsGenerating = useCallback(() => {
    update({ step: 'tune', questionGenerating: true, error: null });
  }, [update]);

  const questionsGenerated = useCallback((questions: TransformQuestionResponse[]) => {
    update({ questionGenerating: false, questions, userAnswers: prefillDefaults(questions) });
  }, [update]);

  const questionsFailed = useCallback((error: string) => {
    update({ questionGenerating: false, questions: null, error });
  }, [update]);

  const answerUpdated = useCallback((questionId: string, answer: string) => {
    update({ userAnswers: { ...state.userAnswers, [questionId]: answer } });
  }, [update, state.userAnswers]);

  const transformStarted = useCallback((adoptId: string) => {
    update({ step: 'build', transforming: true, backgroundAdoptId: adoptId, transformPhase: 'running', transformLines: [], error: null });
  }, [update]);

  const transformLines = useCallback((lines: string[]) => {
    update({ transformLines: lines });
  }, [update]);

  const transformPhase = useCallback((phase: CliRunPhase) => {
    update({ transformPhase: phase });
  }, [update]);

  const awaitingAnswers = useCallback((questions: TransformQuestionResponse[]) => {
    update({ step: 'tune', transforming: false, transformPhase: 'idle', questions, questionGenerating: false, userAnswers: prefillDefaults(questions) });
  }, [update]);

  const transformCompleted = useCallback((draft: N8nPersonaDraft) => {
    update({ step: 'create', transforming: false, transformPhase: 'completed', draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null });
  }, [update]);

  const transformFailed = useCallback((error: string) => {
    update({ transforming: false, backgroundAdoptId: null, transformPhase: 'failed', error });
  }, [update]);

  const transformCancelled = useCallback(() => {
    update({ step: 'choose', transforming: false, backgroundAdoptId: null, transformPhase: 'idle', transformLines: [], error: null });
  }, [update]);

  const confirmStarted = useCallback(() => {
    update({ confirming: true, error: null });
  }, [update]);

  const confirmCompleted = useCallback(() => {
    update({ confirming: false, created: true });
  }, [update]);

  const confirmFailed = useCallback((error: string) => {
    update({ confirming: false, error });
  }, [update]);

  const restoreContext = useCallback((templateName: string, designResultJson: string, adoptId: string) => {
    update({ step: 'build', templateName, designResultJson, backgroundAdoptId: adoptId, transforming: true, transformPhase: 'running' });
  }, [update]);

  return {
    state,
    canGoBack: core.canGoBack,
    goBack: core.goBack,
    // Core shared actions
    ...({ setAdjustment: core.setAdjustment, draftUpdated: core.draftUpdated, draftJsonEdited: core.draftJsonEdited, setError: core.setError, clearError: core.clearError, goToStep: core.goToStep, reset: core.reset }),
    // Entity selection
    toggleUseCaseId,
    toggleTool,
    toggleTrigger,
    toggleConnector,
    toggleChannel,
    toggleEvent,
    updateVariable,
    updateTriggerConfig,
    // Connector credential mapping
    setConnectorCredential,
    clearConnectorCredential,
    setInlineCredentialConnector,
    // Create step
    toggleEditInline,
    // Domain-specific actions
    init,
    questionsGenerating,
    questionsGenerated,
    questionsFailed,
    answerUpdated,
    transformStarted,
    transformLines,
    transformPhase,
    awaitingAnswers,
    transformCompleted,
    transformFailed,
    transformCancelled,
    confirmStarted,
    confirmCompleted,
    confirmFailed,
    restoreContext,
  };
}
