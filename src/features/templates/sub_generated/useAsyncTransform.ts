/**
 * useAsyncTransform — consolidates CLI stream, background snapshot polling,
 * localStorage persistence, and all async adoption handlers into a single
 * orchestration layer.
 */
import { useCallback, useRef, useState } from 'react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { useBackgroundSnapshot } from '@/hooks/utility/useBackgroundSnapshot';
import { usePersistedContext } from '@/hooks/utility/usePersistedContext';
import {
  startTemplateAdoptBackground,
  getTemplateAdoptSnapshot,
  clearTemplateAdoptSnapshot,
  cancelTemplateAdopt,
  confirmTemplateAdoptDraft,
  continueTemplateAdopt,
} from '@/api/templateAdopt';
import { usePersonaStore } from '@/stores/personaStore';
import {
  normalizeDraft,
  normalizeDraftFromUnknown,
  stringifyDraft,
} from '@/features/templates/sub_n8n/n8nTypes';
import {
  filterDesignResult,
  applyTriggerConfigs,
  substituteVariables,
} from './templateVariables';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { TransformQuestionResponse } from '@/api/n8nTransform';
import type { AdoptState, PersistedAdoptContext } from './useAdoptReducer';
import { ADOPT_CONTEXT_KEY, ADOPT_CONTEXT_MAX_AGE_MS } from './useAdoptReducer';

// ── Types ──

interface WizardActions {
  transformStarted: (adoptId: string) => void;
  transformLines: (lines: string[]) => void;
  transformPhase: (phase: 'idle' | 'running' | 'completed' | 'failed') => void;
  transformCompleted: (draft: N8nPersonaDraft) => void;
  transformFailed: (error: string) => void;
  transformCancelled: () => void;
  questionsGenerated: (questions: TransformQuestionResponse[]) => void;
  confirmStarted: () => void;
  confirmCompleted: () => void;
  confirmFailed: (error: string) => void;
  restoreContext: (templateName: string, designResultJson: string, adoptId: string) => void;
  setAdjustment: (text: string) => void;
  draftUpdated: (draft: N8nPersonaDraft) => void;
  reset: () => void;
  setError: (error: string) => void;
}

interface UseAsyncTransformOptions {
  state: AdoptState;
  wizard: WizardActions;
  reviewTestCaseName: string | undefined;
  onPersonaCreated: () => void;
  isOpen: boolean;
}

// ── Hook ──

export function useAsyncTransform({
  state,
  wizard,
  reviewTestCaseName,
  onPersonaCreated,
  isOpen,
}: UseAsyncTransformOptions) {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setTemplateAdoptActive = usePersonaStore((s) => s.setTemplateAdoptActive);
  const confirmingRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // ── CLI stream ──

  const {
    runId: currentAdoptId,
    start: startAdoptStream,
    reset: resetAdoptStream,
    setLines: setStreamLines,
    setPhase: setStreamPhase,
  } = useCorrelatedCliStream({
    outputEvent: 'template-adopt-output',
    statusEvent: 'template-adopt-status',
    idField: 'adopt_id',
    onFailed: (message) => wizard.transformFailed(message),
  });

  // ── Restore persisted context ──

  const handleRestoreContext = useCallback(
    (parsed: PersistedAdoptContext) => {
      setIsRestoring(true);
      wizard.restoreContext(parsed.templateName || '', parsed.designResultJson || '', parsed.adoptId);
      void startAdoptStream(parsed.adoptId);
    },
    [wizard.restoreContext, startAdoptStream],
  );

  usePersistedContext<PersistedAdoptContext>({
    key: ADOPT_CONTEXT_KEY,
    maxAge: ADOPT_CONTEXT_MAX_AGE_MS,
    enabled: isOpen,
    validate: useCallback((parsed: PersistedAdoptContext) => parsed?.adoptId || null, []),
    getSavedAt: useCallback((parsed: PersistedAdoptContext) => parsed.savedAt, []),
    onRestore: handleRestoreContext,
  });

  // ── Snapshot callbacks ──

  const handleSnapshotLines = useCallback(
    (lines: string[]) => {
      wizard.transformLines(lines);
      setStreamLines(lines);
    },
    [wizard.transformLines, setStreamLines],
  );

  const handleSnapshotPhase = useCallback(
    (phase: 'running' | 'completed' | 'failed') => {
      wizard.transformPhase(phase);
      setStreamPhase(phase);
    },
    [wizard.transformPhase, setStreamPhase],
  );

  const handleSnapshotDraft = useCallback(
    (draft: N8nPersonaDraft) => {
      try {
        wizard.transformCompleted(normalizeDraft(draft));
      } catch {
        wizard.transformCompleted(draft);
      }
      setIsRestoring(false);
      setTemplateAdoptActive(false);
    },
    [wizard.transformCompleted, setTemplateAdoptActive],
  );

  const handleSnapshotCompletedNoDraft = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
    wizard.transformFailed('Transform completed but no draft was generated. Please try again.');
  }, [wizard.transformFailed, setTemplateAdoptActive]);

  const handleSnapshotFailed = useCallback(
    (error: string) => {
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      wizard.transformFailed(error);
    },
    [wizard.transformFailed, setTemplateAdoptActive],
  );

  const handleSnapshotSessionLost = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
    wizard.transformFailed('Adoption session lost. The backend may have restarted. Please try again.');
  }, [wizard.transformFailed, setTemplateAdoptActive]);

  const handleSnapshotQuestions = useCallback(
    (questions: unknown[]) => {
      const mapped = questions
        .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
        .map((q) => ({
          id: String(q.id ?? ''),
          question: String(q.question ?? ''),
          type: (q.type === 'select' || q.type === 'text' || q.type === 'boolean' ? q.type : 'text') as 'select' | 'text' | 'boolean',
          options: Array.isArray(q.options) ? q.options.map(String) : undefined,
          default: typeof q.default === 'string' ? q.default : undefined,
          context: typeof q.context === 'string' ? q.context : undefined,
        }));
      if (mapped.length > 0) wizard.questionsGenerated(mapped);
    },
    [wizard.questionsGenerated],
  );

  useBackgroundSnapshot({
    snapshotId: state.backgroundAdoptId,
    getSnapshot: getTemplateAdoptSnapshot,
    onLines: handleSnapshotLines,
    onPhase: handleSnapshotPhase,
    onDraft: handleSnapshotDraft,
    onCompletedNoDraft: handleSnapshotCompletedNoDraft,
    onFailed: handleSnapshotFailed,
    onSessionLost: handleSnapshotSessionLost,
    onQuestions: handleSnapshotQuestions,
  });

  // ── Async handlers ──

  const startTransform = useCallback(async () => {
    if (state.transforming || state.confirming) return;
    if (!state.designResult || !state.designResultJson?.trim()) {
      wizard.setError('Template has no design data. Cannot adopt.');
      return;
    }

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
      } catch { /* localStorage might be full */ }

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
          notifications: {
            channels: state.notificationChannels,
            alertChannel: state.alertChannel,
            severity: state.alertSeverity,
          },
          humanReview: {
            required: state.requireApproval,
            autoApprove: state.autoApproveSeverity,
            timeout: state.reviewTimeout,
          },
          execution: {
            maxConcurrent: state.maxConcurrent,
            timeoutMs: state.timeoutMs,
            maxBudgetUsd: state.maxBudgetUsd,
          },
        },
      });

      const connectorSwapsJson =
        Object.keys(state.connectorSwaps).length > 0
          ? JSON.stringify(state.connectorSwaps)
          : null;

      await startTemplateAdoptBackground(
        adoptId,
        state.templateName,
        designResultJson,
        state.adjustmentRequest.trim() || null,
        previousDraftJson,
        userAnswersJson,
        connectorSwapsJson,
      );

      if (state.adjustmentRequest.trim()) wizard.setAdjustment('');
    } catch (err) {
      setTemplateAdoptActive(false);
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      wizard.transformFailed(err instanceof Error ? err.message : 'Failed to start template adoption.');
    }
  }, [state, wizard, startAdoptStream, resetAdoptStream, setTemplateAdoptActive]);

  const cancelTransform = useCallback(async () => {
    try {
      const adoptId = state.backgroundAdoptId || currentAdoptId;
      if (adoptId) {
        try { await cancelTemplateAdopt(adoptId); } catch { void clearTemplateAdoptSnapshot(adoptId).catch(() => {}); }
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      void resetAdoptStream();
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      wizard.transformCancelled();
    } catch {
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      wizard.transformCancelled();
    }
  }, [state.backgroundAdoptId, currentAdoptId, wizard, resetAdoptStream, setTemplateAdoptActive]);

  const continueTransform = useCallback(async () => {
    const adoptId = state.backgroundAdoptId;
    if (!adoptId || state.transforming || state.confirming) return;

    const hasAnswers = Object.keys(state.userAnswers).length > 0;
    const userAnswersJson = hasAnswers ? JSON.stringify(state.userAnswers) : '{}';

    try {
      wizard.transformStarted(adoptId);
      setTemplateAdoptActive(true);
      await continueTemplateAdopt(adoptId, userAnswersJson);
    } catch (err) {
      setTemplateAdoptActive(false);
      wizard.transformFailed(err instanceof Error ? err.message : 'Failed to continue template adoption.');
    }
  }, [state.backgroundAdoptId, state.transforming, state.confirming, state.userAnswers, wizard, setTemplateAdoptActive]);

  const confirmSave = useCallback(async () => {
    if (confirmingRef.current) return;
    const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
    if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

    confirmingRef.current = true;
    try {
      wizard.confirmStarted();

      let parsed: unknown;
      try { parsed = JSON.parse(payloadJson); } catch (parseErr) {
        wizard.confirmFailed(`Draft JSON is malformed: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`);
        return;
      }

      const normalized = normalizeDraftFromUnknown(parsed);
      if (!normalized) {
        wizard.confirmFailed('Draft JSON is invalid. Please fix draft fields.');
        return;
      }

      const response = await confirmTemplateAdoptDraft(stringifyDraft(normalized), reviewTestCaseName);
      await fetchPersonas();
      selectPersona(response.persona.id);

      if (response.entity_errors?.length) {
        const failedNames = response.entity_errors.map((e) => `${e.entity_type} "${e.entity_name}"`).join(', ');
        console.warn(`[adopt] Persona created with ${response.entity_errors.length} entity errors: ${failedNames}`);
      }
      wizard.confirmCompleted();

      if (state.backgroundAdoptId) {
        void clearTemplateAdoptSnapshot(state.backgroundAdoptId).catch(() => {});
      }
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
      onPersonaCreated();
    } catch (err) {
      wizard.confirmFailed(err instanceof Error ? err.message : 'Failed to create persona.');
    } finally {
      confirmingRef.current = false;
    }
  }, [state, wizard, fetchPersonas, selectPersona, onPersonaCreated, reviewTestCaseName]);

  /** Clean up all async state (for close / reset). */
  const cleanupAll = useCallback(async () => {
    const snapshotId = state.backgroundAdoptId || currentAdoptId;
    if (snapshotId) void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
    try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* ignore */ }
    void resetAdoptStream();
    setTemplateAdoptActive(false);
  }, [state.backgroundAdoptId, currentAdoptId, resetAdoptStream, setTemplateAdoptActive]);

  return {
    currentAdoptId,
    isRestoring,
    startTransform,
    cancelTransform,
    continueTransform,
    confirmSave,
    cleanupAll,
  };
}
