import { useCallback } from 'react';
import type { AgentIR } from '@/lib/types/designTypes';
import { useWizardReducer } from '@/hooks/useWizardReducer';
import { toggleInSet, initSelectionsFromDesignResult } from './adoptHelpers';
import { useAdoptDomainActions } from './adoptActions';
import { INITIAL_STATE } from './adoptInitialState';
import { ADOPT_STEP_META } from './adoptTypes';
import type { AdoptState } from './adoptTypes';

// Re-export all types and constants so existing consumers are unaffected
export type { AdoptEntityError, PersistedAdoptContext, AdoptWizardStep, AdoptState } from './adoptTypes';
export { ADOPT_CONTEXT_KEY, ADOPT_CONTEXT_MAX_AGE_MS, ADOPT_STEPS, ADOPT_STEP_META } from './adoptTypes';

// -- Hook --

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

  const domainActions = useAdoptDomainActions(update, updateFn);

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

  // -- Entity selection toggles --

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

  // -- Variable & trigger config --

  const updateVariable = useCallback((key: string, value: string) => {
    updateFn((prev) => ({ ...prev, variableValues: { ...prev.variableValues, [key]: value } }));
  }, [updateFn]);

  const updateTriggerConfig = useCallback((triggerIdx: number, config: Record<string, string>) => {
    updateFn((prev) => ({ ...prev, triggerConfigs: { ...prev.triggerConfigs, [triggerIdx]: config } }));
  }, [updateFn]);

  // -- Persona preferences (Tune step) --

  const updatePreference = useCallback((key: string, value: unknown) => {
    update({ [key]: value } as Partial<AdoptState>);
  }, [update]);

  // -- Connector credential mapping (Connect step) --

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

  // -- Create step --

  const toggleEditInline = useCallback(() => {
    updateFn((prev) => ({ ...prev, showEditInline: !prev.showEditInline }));
  }, [updateFn]);

  // -- Database setup (inline in Connect step) --

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
    ...domainActions,
  };
}
