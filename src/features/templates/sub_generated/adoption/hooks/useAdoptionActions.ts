/**
 * useAdoptionActions -- step transitions, credential wrappers, quick adopt,
 * draft recovery, and convenience helpers.
 *
 * Extracted from AdoptionWizardContext to isolate action/handler concerns.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { validateVariables, getAdoptionRequirements } from '../templateVariables';
import type { RequiredConnector } from '../steps/connect/ConnectStep';
import {
  type AdoptWizardStep,
  type AdoptState,
} from './useAdoptReducer';
import type { useAdoptReducer } from './useAdoptReducer';
import { STEP_TRANSITIONS } from '../state/stepTransitions';
import type { useAsyncTransform } from './useAsyncTransform';

interface UseAdoptionActionsOptions {
  state: AdoptState;
  wizard: ReturnType<typeof useAdoptReducer>;
  async: ReturnType<typeof useAsyncTransform>;
  requiredConnectors: RequiredConnector[];
  adoptionRequirements: ReturnType<typeof getAdoptionRequirements>;
  manualSelectionsRef: MutableRefObject<Set<string>>;
}

export function useAdoptionActions({
  state,
  wizard,
  async: asyncOps,
  requiredConnectors,
  adoptionRequirements,
  manualSelectionsRef,
}: UseAdoptionActionsOptions) {
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const setAdoptionDraft = useSystemStore((s) => s.setAdoptionDraft);

  // -- Step transition handler --

  const handleNext = useCallback(() => {
    const transition = STEP_TRANSITIONS[state.step](state);
    switch (transition.action) {
      case 'navigate':
        if (transition.target) wizard.goToStep(transition.target);
        break;
      case 'transform':
        void asyncOps.startTransform();
        break;
      case 'continue':
        void asyncOps.continueTransform();
        break;
      case 'confirm':
        void asyncOps.confirmSave();
        break;
      case 'close':
        break;
    }
  }, [state, wizard, asyncOps]);

  // -- Credential wrappers (manual-selection-aware) --

  const setConnectorCredential = useCallback((connectorName: string, credentialId: string) => {
    manualSelectionsRef.current.add(connectorName);
    wizard.setConnectorCredential(connectorName, credentialId);
  }, [wizard.setConnectorCredential, manualSelectionsRef]);

  const clearConnectorCredential = useCallback((connectorName: string) => {
    manualSelectionsRef.current.add(connectorName);
    wizard.clearConnectorCredential(connectorName);
  }, [wizard.clearConnectorCredential, manualSelectionsRef]);

  const handleCredentialCreated = useCallback(() => {
    void fetchCredentials();
  }, [fetchCredentials]);

  const handleSkipQuestions = useCallback(() => {
    void asyncOps.continueTransform();
  }, [asyncOps.continueTransform]);

  const updateDraft = useCallback(
    (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
      if (!state.draft) return;
      wizard.draftUpdated(updater(state.draft));
    },
    [state.draft, wizard],
  );

  // -- Auto-adoption helpers --

  const quickAdoptingRef = useRef(false);
  const quickAdoptPendingRef = useRef(false);

  const quickAdopt = useCallback(() => {
    if (quickAdoptingRef.current) return;

    // Check connector credential readiness
    const unmappedConnectors = requiredConnectors.filter(
      (rc) => !state.connectorCredentialMap[rc.activeName],
    );
    if (unmappedConnectors.length > 0) {
      const names = unmappedConnectors.map((c) => getConnectorMeta(c.activeName).label);
      wizard.goToStep('connect');
      wizard.setError(`Link credentials before quick adopt: ${names.join(', ')}`);
      return;
    }

    const validation = validateVariables(adoptionRequirements, state.variableValues);
    if (!validation.valid) {
      wizard.goToStep('tune');
      wizard.setError(`Fill required fields before quick adopt: ${validation.missing.join(', ')}`);
      return;
    }

    quickAdoptingRef.current = true;
    quickAdoptPendingRef.current = true;
    wizard.goToStep('tune');
  }, [wizard, asyncOps, adoptionRequirements, state.variableValues, requiredConnectors, state.connectorCredentialMap]);

  useEffect(() => {
    if (!quickAdoptPendingRef.current || state.step !== 'tune') return;
    quickAdoptPendingRef.current = false;
    void asyncOps.startTransform().finally(() => {
      quickAdoptingRef.current = false;
    });
  }, [state.step, asyncOps.startTransform]);

  const enterFullWizard = useCallback(() => {
    wizard.setAutoResolved(false);
  }, [wizard]);

  // -- Draft recovery --

  const saveDraftToStore = useCallback(() => {
    if (state.step === 'choose' && Object.keys(state.connectorCredentialMap).length === 0) return;
    if (state.created) return;

    const resumeStep: AdoptWizardStep =
      (state.step === 'build' || state.step === 'create') && (state.backgroundAdoptId || state.draft)
        ? 'build'
        : state.step === 'create' ? 'tune' : state.step;

    setAdoptionDraft({
      reviewId: state.reviewId,
      templateName: state.templateName,
      step: resumeStep,
      connectorSwaps: { ...state.connectorSwaps },
      connectorCredentialMap: { ...state.connectorCredentialMap },
      variableValues: { ...state.variableValues },
      savedAt: Date.now(),
      triggerConfigs: { ...state.triggerConfigs },
      requireApproval: state.requireApproval,
      autoApproveSeverity: state.autoApproveSeverity,
      reviewTimeout: state.reviewTimeout,
      memoryEnabled: state.memoryEnabled,
      memoryScope: state.memoryScope,
      userAnswers: { ...state.userAnswers },
      backgroundAdoptId: state.backgroundAdoptId,
      selectedUseCaseIds: [...state.selectedUseCaseIds],
    });
  }, [state, setAdoptionDraft]);

  const discardDraft = useCallback(() => {
    setAdoptionDraft(null);
    void asyncOps.cleanupAll();
    wizard.reset();
  }, [setAdoptionDraft, asyncOps, wizard]);

  // Clear draft when persona is successfully created
  useEffect(() => {
    if (state.created) {
      setAdoptionDraft(null);
    }
  }, [state.created, setAdoptionDraft]);

  return {
    handleNext,
    setConnectorCredential,
    clearConnectorCredential,
    handleCredentialCreated,
    handleSkipQuestions,
    updateDraft,
    quickAdopt,
    enterFullWizard,
    saveDraftToStore,
    discardDraft,
  };
}
