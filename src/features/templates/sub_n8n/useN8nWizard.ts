import { useCallback, useRef, useEffect, useState } from 'react';
import { parseWorkflowFile } from '@/lib/personas/workflowParser';
import { isSupportedFile } from '@/lib/personas/workflowDetector';
import {
  cancelN8nTransform,
  clearN8nTransformSnapshot,
  confirmN8nPersonaDraft,
  continueN8nTransform,
  startN8nTransformBackground,
} from '@/api/n8nTransform';
import { testN8nDraft } from '@/api/tests';
import { usePersonaStore } from '@/stores/personaStore';
import {
  normalizeDraftFromUnknown,
  stringifyDraft,
} from './n8nTypes';
import { useN8nImportReducer, STEP_META } from './useN8nImportReducer';
import { useN8nSession } from './useN8nSession';
import { useN8nTransform } from './useN8nTransform';
import { useN8nTest } from './useN8nTest';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { ConfirmResult } from './N8nConfirmStep';

/**
 * Orchestrator hook for the n8n import wizard.
 *
 * Composes useN8nSession, useN8nTransform, and useN8nTest, wires them to
 * the useN8nImportReducer, and exposes a clean API for the thin UI renderer.
 */
export function useN8nWizard() {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setN8nTransformActive = usePersonaStore((s) => s.setN8nTransformActive);
  const { state, dispatch, canGoBack, goBack } = useN8nImportReducer();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevStepRef = useRef(STEP_META[state.step].index);
  const confirmingRef = useRef(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  // ── Composed hooks ──

  const session = useN8nSession(state, dispatch);

  const transform = useN8nTransform(
    state.backgroundTransformId,
    state.snapshotEpoch,
    dispatch,
    session.clearPersistedContext,
    setN8nTransformActive,
  );

  const test = useN8nTest(dispatch);

  // ── Slide direction tracking ──

  const currentIndex = STEP_META[state.step].index;
  const direction = currentIndex >= prevStepRef.current ? 1 : -1;
  useEffect(() => {
    prevStepRef.current = currentIndex;
  }, [currentIndex]);

  // Destructure stable function references for useCallback deps
  const { clearPersistedContext, create: createSession, remove: removeSession } = session;
  const { resetTransformStream, setIsRestoring } = transform;
  const { resetTestStream } = test;

  // ── Handlers ──

  const processFile = useCallback(
    (file: File) => {
      try {
        if (!isSupportedFile(file.name)) {
          dispatch({ type: 'SET_ERROR', error: 'Unsupported file type. Accepts .json (n8n, Zapier, Make) or .yml/.yaml (GitHub Actions).' });
          return;
        }

        if (file.size > 5 * 1024 * 1024) {
          dispatch({ type: 'SET_ERROR', error: 'File is too large (max 5MB). Please use a smaller workflow export.' });
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const content = e.target?.result as string;
            if (!content || content.length === 0) {
              dispatch({ type: 'SET_ERROR', error: 'File is empty.' });
              return;
            }

            let parseResult;
            try {
              parseResult = parseWorkflowFile(content, file.name);
            } catch (parseErr) {
              dispatch({
                type: 'SET_ERROR',
                error: `Failed to analyze workflow: ${parseErr instanceof Error ? parseErr.message : 'unknown error'}`,
              });
              return;
            }

            const { detection, result, workflowName: wfName, rawJson } = parseResult;

            // Close the previous session (if any) to prevent orphaned DB rows
            removeSession();

            // Clear stale restore state before loading new file
            clearPersistedContext();
            void resetTransformStream();
            setIsRestoring(false);

            dispatch({
              type: 'FILE_PARSED',
              workflowName: wfName,
              rawWorkflowJson: rawJson,
              parsedResult: result,
              platform: detection.platform,
            });

            // Create persistent session — auto-sync will push parserResult
            void createSession(wfName, rawJson).catch(() => {});
          } catch (err) {
            dispatch({
              type: 'SET_ERROR',
              error: err instanceof Error ? err.message : 'Failed to parse workflow file.',
            });
          }
        };
        reader.onerror = () => dispatch({ type: 'SET_ERROR', error: 'Failed to read the file.' });
        reader.readAsText(file);
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          error: `Unexpected error: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
    [dispatch, removeSession, clearPersistedContext, resetTransformStream, setIsRestoring, createSession],
  );

  const handleTransform = async () => {
    if (!state.parsedResult || !state.rawWorkflowJson || state.transforming || state.confirming) return;

    try {
      const transformId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const isAdjustment = !!state.adjustmentRequest.trim() || !!state.draft;
      const subPhase = isAdjustment ? 'generating' as const : 'asking' as const;

      setIsRestoring(false);
      transform.setAnalyzing(true);
      await transform.startTransformStream(transformId);
      dispatch({ type: 'TRANSFORM_STARTED', transformId, subPhase });
      setN8nTransformActive(true);
      transform.setAnalyzing(false);

      // DB + localStorage sync handled automatically by useN8nSession

      const previousDraftJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim() || null;

      let parserJson: string;
      try {
        parserJson = JSON.stringify(state.parsedResult);
      } catch {
        parserJson = '{}';
      }

      const storeState = usePersonaStore.getState();
      const connectorsJson = JSON.stringify(
        storeState.connectorDefinitions.map((c) => ({ name: c.name, label: c.label })),
      );
      const credentialsJson = JSON.stringify(
        storeState.credentials.map((c) => ({ name: c.name, service_type: c.service_type })),
      );

      const userAnswersJson = Object.keys(state.userAnswers).length > 0
        ? JSON.stringify(state.userAnswers)
        : null;

      await startN8nTransformBackground(
        transformId,
        state.workflowName || 'Imported Workflow',
        state.rawWorkflowJson,
        parserJson,
        state.adjustmentRequest.trim() || null,
        previousDraftJson,
        connectorsJson,
        credentialsJson,
        userAnswersJson,
        state.sessionId,
      );

      if (state.adjustmentRequest.trim()) {
        dispatch({ type: 'SET_ADJUSTMENT', text: '' });
      }
    } catch (err) {
      transform.setAnalyzing(false);
      setN8nTransformActive(false);
      dispatch({
        type: 'TRANSFORM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to generate transformation draft.',
      });
    }
  };

  const handleConfirmSave = async () => {
    if (confirmingRef.current) return;
    try {
      const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
      if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

      confirmingRef.current = true;
      dispatch({ type: 'CONFIRM_STARTED' });

      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadJson);
      } catch (parseErr) {
        dispatch({ type: 'CONFIRM_FAILED', error: `Draft JSON is malformed: ${parseErr instanceof Error ? parseErr.message : 'parse error'}` });
        return;
      }

      const normalized = normalizeDraftFromUnknown(parsed);
      if (!normalized) {
        dispatch({ type: 'CONFIRM_FAILED', error: 'Draft JSON is invalid. Please fix draft fields.' });
        return;
      }

      const response = await confirmN8nPersonaDraft(payloadJson, state.sessionId);
      await fetchPersonas();
      selectPersona(response.persona.id);

      const responseObj = response as Record<string, unknown>;
      const rawErrors = Array.isArray(responseObj.entity_errors) ? responseObj.entity_errors : [];
      setConfirmResult({
        triggersCreated: typeof responseObj.triggers_created === 'number' ? responseObj.triggers_created : 0,
        toolsCreated: typeof responseObj.tools_created === 'number' ? responseObj.tools_created : 0,
        connectorsNeedingSetup: Array.isArray(responseObj.connectors_needing_setup)
          ? (responseObj.connectors_needing_setup as string[])
          : [],
        entityErrors: rawErrors as ConfirmResult['entityErrors'],
      });

      dispatch({ type: 'CONFIRM_COMPLETED' });

      session.remove();

      if (state.backgroundTransformId) {
        void clearN8nTransformSnapshot(state.backgroundTransformId).catch(() => {});
      }
      clearPersistedContext();
    } catch (err) {
      dispatch({
        type: 'CONFIRM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to confirm and save persona.',
      });
    } finally {
      confirmingRef.current = false;
    }
  };

  const handleTestDraft = async () => {
    if (!state.draft || state.testStatus === 'running') return;
    const testId = crypto.randomUUID();
    dispatch({ type: 'TEST_STREAM_STARTED', testId });
    try {
      await test.startTestStream(testId);
      await testN8nDraft(testId, stringifyDraft(state.draft));
    } catch (err) {
      dispatch({ type: 'TEST_FAILED', error: err instanceof Error ? err.message : 'Test failed' });
    }
  };

  const handleCancelTransform = async () => {
    try {
      const transformId = state.backgroundTransformId || transform.currentTransformId;
      if (transformId) {
        try {
          await cancelN8nTransform(transformId);
        } catch {
          void clearN8nTransformSnapshot(transformId).catch(() => {});
        }
      }
      clearPersistedContext();
      void resetTransformStream();
      setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'TRANSFORM_CANCELLED' });
    } catch {
      setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'TRANSFORM_CANCELLED' });
    }
  };

  const handleReset = () => {
    try {
      const snapshotId = state.backgroundTransformId || transform.currentTransformId;
      if (snapshotId) {
        void clearN8nTransformSnapshot(snapshotId).catch(() => {});
      }
      clearPersistedContext();
      void resetTransformStream();
      void resetTestStream();
      setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'RESET' });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setN8nTransformActive(false);
      dispatch({ type: 'RESET' });
    }
  };

  const updateDraft = useCallback(
    (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
      if (!state.draft) return;
      dispatch({ type: 'DRAFT_UPDATED', draft: updater(state.draft) });
    },
    [state.draft, dispatch],
  );

  const handleContinueTransform = async () => {
    if (!state.backgroundTransformId) return;

    try {
      dispatch({ type: 'TRANSFORM_STARTED', transformId: state.backgroundTransformId, subPhase: 'generating' });
      setN8nTransformActive(true);
      await transform.startTransformStream(state.backgroundTransformId);

      const userAnswersJson = Object.keys(state.userAnswers).length > 0
        ? JSON.stringify(state.userAnswers)
        : '{}';

      await continueN8nTransform(
        state.backgroundTransformId,
        userAnswersJson,
        state.sessionId,
      );
    } catch (err) {
      setN8nTransformActive(false);
      dispatch({
        type: 'TRANSFORM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to continue transformation.',
      });
    }
  };

  // ── Next step handler ──

  const handleNext = () => {
    switch (state.step) {
      case 'analyze':
        void handleTransform();
        break;
      case 'transform':
        if (state.transformSubPhase === 'answering') {
          void handleContinueTransform();
        } else if (state.draft) {
          dispatch({ type: 'GO_TO_STEP', step: 'edit' });
        }
        break;
      case 'edit':
        dispatch({ type: 'GO_TO_STEP', step: 'confirm' });
        break;
      case 'confirm':
        void handleConfirmSave();
        break;
    }
  };

  return {
    // State
    state,
    dispatch,

    // Navigation
    canGoBack,
    goBack,
    handleNext,

    // Handlers
    processFile,
    handleTransform,
    handleCancelTransform,
    handleTestDraft,
    handleReset,
    updateDraft,

    // Transform state
    currentTransformId: transform.currentTransformId,
    isRestoring: transform.isRestoring,
    analyzing: transform.analyzing,

    // Confirm state
    confirmResult,
    connectorsMissing,
    setConnectorsMissing,

    // Refs
    fileInputRef,

    // Animation
    direction,
  };
}
