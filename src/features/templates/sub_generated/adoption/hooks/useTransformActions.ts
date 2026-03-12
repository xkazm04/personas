/**
 * Async transform action handlers: startTransform, cancelTransform, continueTransform.
 */
import { useCallback, type MutableRefObject } from 'react';
import {
  startTemplateAdoptBackground,
  clearTemplateAdoptSnapshot,
  cancelTemplateAdopt,
  continueTemplateAdopt,
} from '@/api/templates/templateAdopt';
import { usePersonaStore } from '@/stores/personaStore';
import { stringifyDraft } from '@/features/templates/sub_n8n/hooks/n8nTypes';
import {
  filterDesignResult,
  applyTriggerConfigs,
  substituteVariables,
} from '../templateVariables';
import { applySandboxOverrides } from '@/lib/templates/templateVerification';
import { requestNotificationPermission } from '@/lib/utils/platform/osNotification';
import type { SandboxPolicy } from '@/lib/types/templateTypes';
import type { AdoptState, PersistedAdoptContext } from './useAdoptReducer';
import { ADOPT_CONTEXT_KEY } from './useAdoptReducer';
import type { WizardActions } from '../state/asyncTransformTypes';
import { clearPersistedContext } from '../state/asyncTransformTypes';

interface UseTransformActionsOptions {
  state: AdoptState;
  wizard: WizardActions;
  currentAdoptId: string | null;
  transformStartingRef: MutableRefObject<boolean>;
  sandboxPolicy: SandboxPolicy | null;
  startAdoptStream: (id: string) => Promise<void>;
  resetAdoptStream: () => Promise<void> | void;
  setIsRestoring: (v: boolean) => void;
}

export function useTransformActions({
  state,
  wizard,
  currentAdoptId,
  transformStartingRef,
  sandboxPolicy,
  startAdoptStream,
  resetAdoptStream,
  setIsRestoring,
}: UseTransformActionsOptions) {
  const setTemplateAdoptActive = usePersonaStore((s) => s.setTemplateAdoptActive);

  const startTransform = useCallback(async () => {
    if (transformStartingRef.current || state.transforming || state.confirming) return;
    if (!state.designResult || !state.designResultJson?.trim()) {
      wizard.setError('Template has no design data. Cannot adopt.');
      return;
    }

    transformStartingRef.current = true;

    // Request notification permission early so it's available when transform completes
    requestNotificationPermission();

    const filtered = filterDesignResult(
      state.designResult,
      {
        selectedToolIndices: state.selectedToolIndices,
        selectedTriggerIndices: state.selectedTriggerIndices,
        selectedConnectorNames: state.selectedConnectorNames,
        selectedChannelIndices: state.selectedChannelIndices,
        selectedEventIndices: state.selectedEventIndices,
      },
      state.connectorSwaps,
    );
    filtered.suggested_triggers = applyTriggerConfigs(filtered.suggested_triggers, state.triggerConfigs);
    const substituted = substituteVariables(filtered, state.variableValues);
    const designResultJson = JSON.stringify(substituted);

    const adoptId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const previousDraftJson = state.draft ? stringifyDraft(state.draft) : null;

    try {
      setIsRestoring(false);
      await startAdoptStream(adoptId);
      wizard.transformStarted(adoptId);
      setTemplateAdoptActive(true);

      try {
        const context: PersistedAdoptContext = {
          adoptId,
          templateName: state.templateName,
          designResultJson,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(ADOPT_CONTEXT_KEY, JSON.stringify(context));
      } catch { /* intentional: non-critical - localStorage cleanup */ }

      // Enforce sandbox policy overrides on user-selected preferences
      const enforced = applySandboxOverrides(sandboxPolicy, {
        maxConcurrent: 1,
        requireApproval: state.requireApproval,
        maxBudgetUsd: null,
      });

      const hasAnswers = Object.keys(state.userAnswers).length > 0;
      const userAnswersJson = JSON.stringify({
        ...(hasAnswers ? state.userAnswers : {}),
        _selections: {
          useCases: [...state.selectedUseCaseIds],
          toolCount: state.selectedToolIndices.size,
          triggerCount: state.selectedTriggerIndices.size,
          connectorNames: [...state.selectedConnectorNames],
        },
        _preferences: {
          humanReview: {
            required: enforced.requireApproval,
            autoApprove: state.autoApproveSeverity,
            timeout: state.reviewTimeout,
          },
          memory: {
            enabled: state.memoryEnabled,
            scope: state.memoryScope,
          },
        },
        // Phase A - pass database config so LLM CLI can handle schema design
        _database: {
          mode: state.databaseMode,
          selectedTableNames: state.selectedTableNames,
        },
        // Phase B - pass template adoption_questions as context for LLM to consider
        // The LLM decides which questions to generate; these are provided as hints
        _templateQuestions: state.designResult?.adoption_questions ?? [],
        // Phase C (Area #9) - pass credential mapping so backend knows which credentials to bind
        _credentialMap: state.connectorCredentialMap,
      });

      const connectorSwapsJson =
        Object.keys(state.connectorSwaps).length > 0
          ? JSON.stringify(state.connectorSwaps)
          : null;

      console.debug(`[adopt:${adoptId}] transform start`, { templateName: state.templateName, isAdjustment: !!state.adjustmentRequest.trim() });
      await startTemplateAdoptBackground(
        adoptId,
        state.templateName,
        designResultJson,
        state.adjustmentRequest.trim() || null,
        previousDraftJson,
        userAnswersJson,
        connectorSwapsJson,
      );
      console.debug(`[adopt:${adoptId}] transform dispatched`);

      if (state.adjustmentRequest.trim()) wizard.setAdjustment('');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to start template adoption.';
      console.debug(`[adopt:${adoptId}] transform fail`, { error: errMsg });
      setTemplateAdoptActive(false);
      clearPersistedContext();
      void resetAdoptStream();
      wizard.transformFailed(errMsg);
    } finally {
      transformStartingRef.current = false;
    }
  }, [state, wizard, startAdoptStream, resetAdoptStream, setTemplateAdoptActive, sandboxPolicy, transformStartingRef, setIsRestoring]);

  const cancelTransform = useCallback(async () => {
    try {
      const adoptId = state.backgroundAdoptId || currentAdoptId;
      if (adoptId) {
        try { await cancelTemplateAdopt(adoptId); } catch { /* intentional: non-critical - best-effort cancellation; clean up snapshot */
          void clearTemplateAdoptSnapshot(adoptId).catch(() => {}); }
      }
      clearPersistedContext();
      void resetAdoptStream();
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      wizard.transformCancelled();
    } catch {
      // intentional: non-critical - ensure cancellation completes even if cleanup fails
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      wizard.transformCancelled();
    }
  }, [state.backgroundAdoptId, currentAdoptId, wizard, resetAdoptStream, setTemplateAdoptActive, setIsRestoring]);

  const continueTransform = useCallback(async () => {
    const adoptId = state.backgroundAdoptId;
    if (!adoptId || state.transforming || state.confirming) return;

    const hasAnswers = Object.keys(state.userAnswers).length > 0;
    const userAnswersJson = hasAnswers ? JSON.stringify(state.userAnswers) : '{}';

    try {
      console.debug(`[adopt:${adoptId}] continue transform start`);
      wizard.transformStarted(adoptId);
      setTemplateAdoptActive(true);
      await continueTemplateAdopt(adoptId, userAnswersJson);
      console.debug(`[adopt:${adoptId}] continue transform dispatched`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to continue template adoption.';
      console.debug(`[adopt:${adoptId}] continue transform fail`, { error: errMsg });
      setTemplateAdoptActive(false);
      wizard.transformFailed(errMsg);
    }
  }, [state.backgroundAdoptId, state.transforming, state.confirming, state.userAnswers, wizard, setTemplateAdoptActive]);

  return { startTransform, cancelTransform, continueTransform };
}
