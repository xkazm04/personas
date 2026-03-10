import { useCallback } from 'react';
import type { N8nPersonaDraft, TransformQuestionResponse } from '@/api/n8nTransform';
<<<<<<< HEAD
import type { AgentIR } from '@/lib/types/designTypes';
=======
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { useWizardReducer } from '@/hooks/useWizardReducer';
import { getAdoptionRequirements, getDefaultValues } from './templateVariables';

export interface AdoptEntityError {
  entity_type: string;
  entity_name: string;
  error: string;
}

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

<<<<<<< HEAD
export type AdoptWizardStep = 'choose' | 'connect' | 'tune' | 'build' | 'create';
=======
export type AdoptWizardStep = 'choose' | 'connect' | 'data' | 'tune' | 'build' | 'create';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

export const ADOPT_STEPS: readonly AdoptWizardStep[] = [
  'choose',
  'connect',
<<<<<<< HEAD
=======
  'data',
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  'tune',
  'build',
  'create',
] as const;

export const ADOPT_STEP_META: Record<AdoptWizardStep, { label: string; index: number }> = {
  choose:  { label: 'Choose',  index: 0 },
  connect: { label: 'Connect', index: 1 },
<<<<<<< HEAD
  tune:    { label: 'Tune',    index: 2 },
  build:   { label: 'Build',   index: 3 },
  create:  { label: 'Create',  index: 4 },
=======
  data:    { label: 'Data',    index: 2 },
  tune:    { label: 'Tune',    index: 3 },
  build:   { label: 'Build',   index: 4 },
  create:  { label: 'Create',  index: 5 },
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
};

// ── Helpers ──

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

<<<<<<< HEAD
function initSelectionsFromDesignResult(design: AgentIR) {
=======
function initSelectionsFromDesignResult(design: DesignAnalysisResult) {
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
  designResult: AgentIR | null;
=======
  designResult: DesignAnalysisResult | null;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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

  // Connector swaps (Connect step — interchangeable connectors)
  /** Original connector name → replacement connector name */
  connectorSwaps: Record<string, string>;

  // Persona preferences (Tune step)
<<<<<<< HEAD
  requireApproval: boolean;
  autoApproveSeverity: string;
  reviewTimeout: string;
  memoryEnabled: boolean;
  memoryScope: string;
=======
  notificationChannels: string[];
  alertChannel: string;
  alertSeverity: string;
  requireApproval: boolean;
  autoApproveSeverity: string;
  reviewTimeout: string;
  maxConcurrent: number;
  timeoutMs: number;
  maxBudgetUsd: number | null;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
  partialEntityErrors: AdoptEntityError[];
  showEditInline: boolean;
  error: string | null;

<<<<<<< HEAD
  // Database setup (inline in Connect step)
  databaseMode: 'create' | 'existing';
  selectedTableNames: string[];

  // Auto-adoption
  autoResolved: boolean;

  // Safety override — user explicitly acknowledges critical scan findings
  safetyCriticalOverride: boolean;
=======
  // Data step
  dataSchemaReady: boolean;

  // Auto-adoption
  autoResolved: boolean;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
  connectorSwaps: {},
<<<<<<< HEAD
  requireApproval: false,
  autoApproveSeverity: 'info',
  reviewTimeout: '24h',
  memoryEnabled: true,
  memoryScope: '',
=======
  notificationChannels: [],
  alertChannel: '',
  alertSeverity: 'warning_critical',
  requireApproval: false,
  autoApproveSeverity: 'info',
  reviewTimeout: '24h',
  maxConcurrent: 1,
  timeoutMs: 420000,
  maxBudgetUsd: null,
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
  partialEntityErrors: [],
  showEditInline: false,
  error: null,
<<<<<<< HEAD
  databaseMode: 'create',
  selectedTableNames: [],
  autoResolved: false,
  safetyCriticalOverride: false,
=======
  dataSchemaReady: false,
  autoResolved: false,
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
};

function prefillDefaults(questions: TransformQuestionResponse[]): Record<string, string> {
  return questions.reduce<Record<string, string>>((acc, q) => {
    if (q.default) acc[q.id] = q.default;
    return acc;
  }, {});
}

<<<<<<< HEAD
=======
/** Check if the current template needs the Data step (has a database connector). */
function hasDataStep(s: AdoptState): boolean {
  const connectors = s.designResult?.suggested_connectors ?? [];
  const DATABASE_CONNECTORS = new Set([
    'personas_database', 'supabase', 'neon', 'planetscale',
    'postgres', 'mongodb', 'duckdb', 'sqlite',
  ]);
  return connectors.some((c) => DATABASE_CONNECTORS.has(c.name));
}

/** Exported for use in context/modal to conditionally show the Data sidebar step. */
export { hasDataStep };

>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
// ── Hook ──

export function useAdoptReducer() {
  const core = useWizardReducer<AdoptState>({
    initialState: INITIAL_STATE,
    stepMeta: ADOPT_STEP_META,
    canGoBack: (s) => s.step !== 'choose' && !s.transforming && !s.confirming && !s.questionGenerating,
    goBack: (s, goToStep) => {
      if (s.step === 'connect') goToStep('choose');
<<<<<<< HEAD
      else if (s.step === 'tune') goToStep('connect');
=======
      else if (s.step === 'data') goToStep('connect');
      else if (s.step === 'tune') goToStep(s.dataSchemaReady || hasDataStep(s) ? 'data' : 'connect');
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      else if (s.step === 'build') goToStep('tune');
      else if (s.step === 'create') {
        if (s.draft) goToStep('build');
        else goToStep('tune');
      }
    },
  });

<<<<<<< HEAD
  const { state, update, updateFn } = core;

  const init = useCallback((templateName: string, reviewId: string, designResult: AgentIR, designResultJson: string) => {
=======
  const { state, update } = core;

  const init = useCallback((templateName: string, reviewId: string, designResult: DesignAnalysisResult, designResultJson: string) => {
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
  // All toggles use updateFn to read from prev state, avoiding stale closures
  // during rapid toggling.

  const toggleUseCaseId = useCallback((id: string) => {
    updateFn((prev) => ({ ...prev, selectedUseCaseIds: toggleInSet(prev.selectedUseCaseIds, id) }));
  }, [updateFn]);
=======

  const toggleUseCaseId = useCallback((id: string) => {
    update({ selectedUseCaseIds: toggleInSet(state.selectedUseCaseIds, id) });
  }, [update, state.selectedUseCaseIds]);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

  const selectAllUseCases = useCallback((ids: string[]) => {
    update({ selectedUseCaseIds: new Set(ids) });
  }, [update]);

  const clearAllUseCases = useCallback(() => {
    update({ selectedUseCaseIds: new Set() });
  }, [update]);

  const toggleTool = useCallback((index: number) => {
<<<<<<< HEAD
    updateFn((prev) => ({ ...prev, selectedToolIndices: toggleInSet(prev.selectedToolIndices, index) }));
  }, [updateFn]);

  const toggleTrigger = useCallback((index: number) => {
    updateFn((prev) => ({ ...prev, selectedTriggerIndices: toggleInSet(prev.selectedTriggerIndices, index) }));
  }, [updateFn]);

  const toggleConnector = useCallback((name: string) => {
    updateFn((prev) => ({ ...prev, selectedConnectorNames: toggleInSet(prev.selectedConnectorNames, name) }));
  }, [updateFn]);

  const swapConnector = useCallback((originalName: string, replacementName: string) => {
    updateFn((prev) => {
      const newSwaps = { ...prev.connectorSwaps };
      const oldActive = prev.connectorSwaps[originalName] || originalName;

      if (originalName === replacementName) {
        delete newSwaps[originalName];
      } else {
        newSwaps[originalName] = replacementName;
      }

      const newSelected = new Set(prev.selectedConnectorNames);
      newSelected.delete(oldActive);
      newSelected.add(replacementName);

      const newCredMap = { ...prev.connectorCredentialMap };
      if (oldActive !== replacementName) {
        delete newCredMap[oldActive];
      }

      return {
        ...prev,
        connectorSwaps: newSwaps,
        selectedConnectorNames: newSelected,
        connectorCredentialMap: newCredMap,
      };
    });
  }, [updateFn]);

  const toggleChannel = useCallback((index: number) => {
    updateFn((prev) => ({ ...prev, selectedChannelIndices: toggleInSet(prev.selectedChannelIndices, index) }));
  }, [updateFn]);

  const toggleEvent = useCallback((index: number) => {
    updateFn((prev) => ({ ...prev, selectedEventIndices: toggleInSet(prev.selectedEventIndices, index) }));
  }, [updateFn]);
=======
    update({ selectedToolIndices: toggleInSet(state.selectedToolIndices, index) });
  }, [update, state.selectedToolIndices]);

  const toggleTrigger = useCallback((index: number) => {
    update({ selectedTriggerIndices: toggleInSet(state.selectedTriggerIndices, index) });
  }, [update, state.selectedTriggerIndices]);

  const toggleConnector = useCallback((name: string) => {
    update({ selectedConnectorNames: toggleInSet(state.selectedConnectorNames, name) });
  }, [update, state.selectedConnectorNames]);

  const swapConnector = useCallback((originalName: string, replacementName: string) => {
    const newSwaps = { ...state.connectorSwaps };
    // Determine the previously active connector for this slot
    const oldActive = state.connectorSwaps[originalName] || originalName;

    // If reverting to the original, remove the swap entry entirely
    if (originalName === replacementName) {
      delete newSwaps[originalName];
    } else {
      newSwaps[originalName] = replacementName;
    }

    const newSelected = new Set(state.selectedConnectorNames);
    newSelected.delete(oldActive);
    newSelected.add(replacementName);

    const newCredMap = { ...state.connectorCredentialMap };
    if (oldActive !== replacementName) {
      delete newCredMap[oldActive];
    }

    update({
      connectorSwaps: newSwaps,
      selectedConnectorNames: newSelected,
      connectorCredentialMap: newCredMap,
    });
  }, [update, state.connectorSwaps, state.selectedConnectorNames, state.connectorCredentialMap]);

  const toggleChannel = useCallback((index: number) => {
    update({ selectedChannelIndices: toggleInSet(state.selectedChannelIndices, index) });
  }, [update, state.selectedChannelIndices]);

  const toggleEvent = useCallback((index: number) => {
    update({ selectedEventIndices: toggleInSet(state.selectedEventIndices, index) });
  }, [update, state.selectedEventIndices]);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

  // ── Variable & trigger config ──

  const updateVariable = useCallback((key: string, value: string) => {
<<<<<<< HEAD
    updateFn((prev) => ({ ...prev, variableValues: { ...prev.variableValues, [key]: value } }));
  }, [updateFn]);

  const updateTriggerConfig = useCallback((triggerIdx: number, config: Record<string, string>) => {
    updateFn((prev) => ({ ...prev, triggerConfigs: { ...prev.triggerConfigs, [triggerIdx]: config } }));
  }, [updateFn]);
=======
    update({ variableValues: { ...state.variableValues, [key]: value } });
  }, [update, state.variableValues]);

  const updateTriggerConfig = useCallback((triggerIdx: number, config: Record<string, string>) => {
    update({ triggerConfigs: { ...state.triggerConfigs, [triggerIdx]: config } });
  }, [update, state.triggerConfigs]);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

  // ── Persona preferences (Tune step) ──

  const updatePreference = useCallback((key: string, value: unknown) => {
    update({ [key]: value } as Partial<AdoptState>);
  }, [update]);

  // ── Connector credential mapping (Connect step) ──

  const setConnectorCredential = useCallback((connectorName: string, credentialId: string) => {
<<<<<<< HEAD
    updateFn((prev) => ({ ...prev, connectorCredentialMap: { ...prev.connectorCredentialMap, [connectorName]: credentialId } }));
  }, [updateFn]);

  const clearConnectorCredential = useCallback((connectorName: string) => {
    updateFn((prev) => {
      const next = { ...prev.connectorCredentialMap };
      delete next[connectorName];
      return { ...prev, connectorCredentialMap: next };
    });
  }, [updateFn]);
=======
    update({ connectorCredentialMap: { ...state.connectorCredentialMap, [connectorName]: credentialId } });
  }, [update, state.connectorCredentialMap]);

  const clearConnectorCredential = useCallback((connectorName: string) => {
    const next = { ...state.connectorCredentialMap };
    delete next[connectorName];
    update({ connectorCredentialMap: next });
  }, [update, state.connectorCredentialMap]);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

  const setInlineCredentialConnector = useCallback((name: string | null) => {
    update({ inlineCredentialConnector: name });
  }, [update]);

  // ── Create step ──

  const toggleEditInline = useCallback(() => {
<<<<<<< HEAD
    updateFn((prev) => ({ ...prev, showEditInline: !prev.showEditInline }));
  }, [updateFn]);

  // ── Database setup (inline in Connect step) ──

  const setDatabaseMode = useCallback((mode: 'create' | 'existing') => {
    update({ databaseMode: mode, selectedTableNames: [] });
  }, [update]);

  const toggleTableName = useCallback((tableName: string) => {
    updateFn((prev) => {
      const current = prev.selectedTableNames;
      const next = current.includes(tableName)
        ? current.filter((t) => t !== tableName)
        : [...current, tableName];
      return { ...prev, selectedTableNames: next };
    });
  }, [updateFn]);

  const setSelectedTableNames = useCallback((names: string[]) => {
    update({ selectedTableNames: names });
  }, [update]);
=======
    update({ showEditInline: !state.showEditInline });
  }, [update, state.showEditInline]);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
<<<<<<< HEAD
    updateFn((prev) => ({ ...prev, userAnswers: { ...prev.userAnswers, [questionId]: answer } }));
  }, [updateFn]);
=======
    update({ userAnswers: { ...state.userAnswers, [questionId]: answer } });
  }, [update, state.userAnswers]);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
<<<<<<< HEAD
    update({ step: 'create', transforming: false, transformPhase: 'completed', draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null, safetyCriticalOverride: false });
=======
    update({ step: 'create', transforming: false, transformPhase: 'completed', draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null });
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  }, [update]);

  const transformFailed = useCallback((error: string) => {
    update({ transforming: false, backgroundAdoptId: null, transformPhase: 'failed', error });
  }, [update]);

  const transformCancelled = useCallback(() => {
<<<<<<< HEAD
    // Resume at tune step instead of resetting to choose (preserves user progress)
    update({ step: 'tune', transforming: false, backgroundAdoptId: null, transformPhase: 'idle', transformLines: [], error: null });
=======
    update({ step: 'choose', transforming: false, backgroundAdoptId: null, transformPhase: 'idle', transformLines: [], error: null });
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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

  const setAutoResolved = useCallback((autoResolved: boolean) => {
    update({ autoResolved });
  }, [update]);

<<<<<<< HEAD
  const setSafetyCriticalOverride = useCallback((override: boolean) => {
    update({ safetyCriticalOverride: override });
  }, [update]);

=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  return {
    state,
    canGoBack: core.canGoBack,
    goBack: core.goBack,
    // Core shared actions
    ...({ setAdjustment: core.setAdjustment, draftUpdated: core.draftUpdated, draftJsonEdited: core.draftJsonEdited, setError: core.setError, clearError: core.clearError, goToStep: core.goToStep, reset: core.reset }),
    // Entity selection
    toggleUseCaseId,
    selectAllUseCases,
    clearAllUseCases,
    toggleTool,
    toggleTrigger,
    toggleConnector,
    swapConnector,
    toggleChannel,
    toggleEvent,
    updateVariable,
    updateTriggerConfig,
    updatePreference,
    // Connector credential mapping
    setConnectorCredential,
    clearConnectorCredential,
    setInlineCredentialConnector,
    // Create step
    toggleEditInline,
<<<<<<< HEAD
    // Database setup
    setDatabaseMode,
    toggleTableName,
    setSelectedTableNames,
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
    setAutoResolved,
<<<<<<< HEAD
    setSafetyCriticalOverride,
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  };
}
