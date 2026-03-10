import { useCallback } from 'react';
import type { N8nPersonaDraft, TransformQuestionResponse } from '@/api/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { useWizardReducer } from '@/hooks/useWizardReducer';
import { getAdoptionRequirements, getDefaultValues } from './templateVariables';

export interface AdoptEntityError {
  entity_type: string;
  entity_name: string;
  error: string;
}

// â”€â”€ Persistence â”€â”€

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

// â”€â”€ Wizard Steps â”€â”€

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

// â”€â”€ Helpers â”€â”€

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function initSelectionsFromDesignResult(design: AgentIR) {
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

// â”€â”€ State â”€â”€

export interface AdoptState {
  step: AdoptWizardStep;

  // Template context
  templateName: string;
  reviewId: string;
  designResult: AgentIR | null;
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

  // Connector swaps (Connect step â€” interchangeable connectors)
  /** Original connector name â†’ replacement connector name */
  connectorSwaps: Record<string, string>;

  // Persona preferences (Tune step)
  requireApproval: boolean;
  autoApproveSeverity: string;
  reviewTimeout: string;
  memoryEnabled: boolean;
  memoryScope: string;

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

  // Database setup (inline in Connect step)
  databaseMode: 'create' | 'existing';
  selectedTableNames: string[];

  // Auto-adoption
  autoResolved: boolean;

  // Safety override â€” user explicitly acknowledges critical scan findings
  safetyCriticalOverride: boolean;
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
  requireApproval: false,
  autoApproveSeverity: 'info',
  reviewTimeout: '24h',
  memoryEnabled: true,
  memoryScope: '',
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
  databaseMode: 'create',
  selectedTableNames: [],
  autoResolved: false,
  safetyCriticalOverride: false,
};

function prefillDefaults(questions: TransformQuestionResponse[]): Record<string, string> {
  return questions.reduce<Record<string, string>>((acc, q) => {
    if (q.default) acc[q.id] = q.default;
    return acc;
  }, {});
}

// â”€â”€ Hook â”€â”€

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

  const { state, update, updateFn } = core;

  const init = useCallback((templateName: string, reviewId: string, designResult: AgentIR, designResultJson: string) => {
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

  // â”€â”€ Entity selection toggles â”€â”€
  // All toggles use updateFn to read from prev state, avoiding stale closures
  // during rapid toggling.

  const toggleUseCaseId = useCallback((id: string) => {
    updateFn((prev) => ({ ...prev, selectedUseCaseIds: toggleInSet(prev.selectedUseCaseIds, id) }));
  }, [updateFn]);

  const selectAllUseCases = useCallback((ids: string[]) => {
    update({ selectedUseCaseIds: new Set(ids) });
  }, [update]);

  const clearAllUseCases = useCallback(() => {
    update({ selectedUseCaseIds: new Set() });
  }, [update]);

  const toggleTool = useCallback((index: number) => {
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

  // â”€â”€ Variable & trigger config â”€â”€

  const updateVariable = useCallback((key: string, value: string) => {
    updateFn((prev) => ({ ...prev, variableValues: { ...prev.variableValues, [key]: value } }));
  }, [updateFn]);

  const updateTriggerConfig = useCallback((triggerIdx: number, config: Record<string, string>) => {
    updateFn((prev) => ({ ...prev, triggerConfigs: { ...prev.triggerConfigs, [triggerIdx]: config } }));
  }, [updateFn]);

  // â”€â”€ Persona preferences (Tune step) â”€â”€

  const updatePreference = useCallback((key: string, value: unknown) => {
    update({ [key]: value } as Partial<AdoptState>);
  }, [update]);

  // â”€â”€ Connector credential mapping (Connect step) â”€â”€

  const setConnectorCredential = useCallback((connectorName: string, credentialId: string) => {
    updateFn((prev) => ({ ...prev, connectorCredentialMap: { ...prev.connectorCredentialMap, [connectorName]: credentialId } }));
  }, [updateFn]);

  const clearConnectorCredential = useCallback((connectorName: string) => {
    updateFn((prev) => {
      const next = { ...prev.connectorCredentialMap };
      delete next[connectorName];
      return { ...prev, connectorCredentialMap: next };
    });
  }, [updateFn]);

  const setInlineCredentialConnector = useCallback((name: string | null) => {
    update({ inlineCredentialConnector: name });
  }, [update]);

  // â”€â”€ Create step â”€â”€

  const toggleEditInline = useCallback(() => {
    updateFn((prev) => ({ ...prev, showEditInline: !prev.showEditInline }));
  }, [updateFn]);

  // â”€â”€ Database setup (inline in Connect step) â”€â”€

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

  // â”€â”€ Existing actions â”€â”€

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
    updateFn((prev) => ({ ...prev, userAnswers: { ...prev.userAnswers, [questionId]: answer } }));
  }, [updateFn]);

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
    update({ step: 'create', transforming: false, transformPhase: 'completed', draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null, safetyCriticalOverride: false });
  }, [update]);

  const transformFailed = useCallback((error: string) => {
    update({ transforming: false, backgroundAdoptId: null, transformPhase: 'failed', error });
  }, [update]);

  const transformCancelled = useCallback(() => {
    // Resume at tune step instead of resetting to choose (preserves user progress)
    update({ step: 'tune', transforming: false, backgroundAdoptId: null, transformPhase: 'idle', transformLines: [], error: null });
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

  const setSafetyCriticalOverride = useCallback((override: boolean) => {
    update({ safetyCriticalOverride: override });
  }, [update]);

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
    // Database setup
    setDatabaseMode,
    toggleTableName,
    setSelectedTableNames,
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
    setSafetyCriticalOverride,
  };
}
