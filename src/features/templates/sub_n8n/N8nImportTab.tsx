import { useCallback, useRef, useEffect, useState } from 'react';
import { useBackgroundSnapshot } from '@/hooks/utility/useBackgroundSnapshot';
import { usePersistedContext } from '@/hooks/utility/usePersistedContext';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { parseN8nWorkflow } from '@/lib/personas/n8nParser';
import {
  cancelN8nTransform,
  clearN8nTransformSnapshot,
  confirmN8nPersonaDraft,
  continueN8nTransform,
  getN8nTransformSnapshot,
  startN8nTransformBackground,
  createN8nSession,
  updateN8nSession,
} from '@/api/tauriApi';
import { deleteN8nSession } from '@/api/n8nTransform';
import { testN8nDraft } from '@/api/tests';
import { usePersonaStore } from '@/stores/personaStore';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import {
  normalizeDraft,
  normalizeDraftFromUnknown,
  stringifyDraft,
  N8N_TRANSFORM_CONTEXT_KEY,
  TRANSFORM_CONTEXT_MAX_AGE_MS,
  type PersistedTransformContext,
} from '@/features/templates/sub_n8n/n8nTypes';
import { useN8nImportReducer, STEP_META } from './useN8nImportReducer';
import { N8nStepIndicator } from './N8nStepIndicator';
import { N8nWizardFooter } from './N8nWizardFooter';
import { N8nUploadStep } from './N8nUploadStep';
import { N8nParserResults } from './N8nParserResults';
import { N8nTransformChat } from './N8nTransformChat';
import { N8nEditStep } from './N8nEditStep';
import { N8nConfirmStep, type ConfirmResult } from './N8nConfirmStep';
import { N8nSessionList } from './N8nSessionList';

// Color presets — synced with ColorPicker.tsx
const COLOR_PRESETS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7',
];

// ── Slide animation variants ──

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

export default function N8nImportTab() {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setN8nTransformActive = usePersonaStore((s) => s.setN8nTransformActive);
  const { state, dispatch, canGoBack, goBack } = useN8nImportReducer();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevStepRef = useRef(STEP_META[state.step].index);
  const sessionIdRef = useRef<string | null>(null);
  const confirmingRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  // Keep sessionId ref in sync for use in closures
  sessionIdRef.current = state.sessionId;

  // Track direction for slide animations
  const currentIndex = STEP_META[state.step].index;
  const direction = currentIndex >= prevStepRef.current ? 1 : -1;
  useEffect(() => {
    prevStepRef.current = currentIndex;
  }, [currentIndex]);

  // ── CLI stream ──

  const {
    runId: currentTransformId,
    start: startTransformStream,
    reset: resetTransformStream,
    setLines: setStreamLines,
    setPhase: setStreamPhase,
  } = useCorrelatedCliStream({
    outputEvent: 'n8n-transform-output',
    statusEvent: 'n8n-transform-status',
    idField: 'transform_id',
    onFailed: (message) => dispatch({ type: 'TRANSFORM_FAILED', error: message }),
  });

  // ── CLI stream for draft test ──

  const {
    start: startTestStream,
    reset: resetTestStream,
    lines: testStreamLines,
    phase: testStreamPhase,
  } = useCorrelatedCliStream({
    outputEvent: 'n8n-test-output',
    statusEvent: 'n8n-test-status',
    idField: 'test_id',
    onFailed: (message) => {
      dispatch({ type: 'TEST_FAILED', error: message });
      // Pre-fill adjustment request with error for easy re-generation
      if (message) {
        dispatch({
          type: 'SET_ADJUSTMENT',
          text: `Fix: The test execution failed with: ${message.slice(0, 200)}. Please adjust the persona to fix this issue.`,
        });
      }
    },
  });

  // Sync test stream into reducer
  useEffect(() => {
    dispatch({ type: 'TEST_LINES', lines: testStreamLines });
  }, [testStreamLines, dispatch]);

  useEffect(() => {
    dispatch({ type: 'TEST_PHASE', phase: testStreamPhase });
    if (testStreamPhase === 'completed') {
      dispatch({ type: 'TEST_PASSED' });
    }
  }, [testStreamPhase, dispatch]);

  // ── Restore persisted context on mount ──

  const handleRestoreContext = useCallback(
    (parsed: PersistedTransformContext) => {
      setIsRestoring(true);
      dispatch({
        type: 'RESTORE_CONTEXT',
        transformId: parsed.transformId,
        workflowName: parsed.workflowName || 'Imported n8n Workflow',
        rawWorkflowJson: parsed.rawWorkflowJson || '',
        parsedResult: parsed.parsedResult || null,
      });
      void startTransformStream(parsed.transformId);
    },
    [dispatch, startTransformStream],
  );

  const validateTransformContext = useCallback(
    (parsed: PersistedTransformContext) => parsed?.transformId || null,
    [],
  );

  const getTransformSavedAt = useCallback(
    (parsed: PersistedTransformContext) => parsed.savedAt,
    [],
  );

  usePersistedContext<PersistedTransformContext>({
    key: N8N_TRANSFORM_CONTEXT_KEY,
    maxAge: TRANSFORM_CONTEXT_MAX_AGE_MS,
    validate: validateTransformContext,
    getSavedAt: getTransformSavedAt,
    onRestore: handleRestoreContext,
  });

  // ── Poll for snapshot updates ──

  const handleSnapshotLines = useCallback(
    (lines: string[]) => {
      dispatch({ type: 'TRANSFORM_LINES', lines });
      setStreamLines(lines);
    },
    [dispatch, setStreamLines],
  );

  const handleSnapshotPhase = useCallback(
    (phase: 'running' | 'completed' | 'failed') => {
      dispatch({ type: 'TRANSFORM_PHASE', phase });
      setStreamPhase(phase);
    },
    [dispatch, setStreamPhase],
  );

  const handleSnapshotDraft = useCallback(
    (draft: import('@/api/n8nTransform').N8nPersonaDraft) => {
      let completedDraft: import('@/api/n8nTransform').N8nPersonaDraft;
      try {
        completedDraft = normalizeDraft(draft);
      } catch {
        completedDraft = draft;
      }
      // Apply a random color from presets if the transform didn't set one
      if (!completedDraft.color || completedDraft.color === '#8b5cf6') {
        completedDraft = {
          ...completedDraft,
          color: COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)] ?? '#8b5cf6',
        };
      }
      dispatch({ type: 'TRANSFORM_COMPLETED', draft: completedDraft });
      void resetTransformStream();
      setIsRestoring(false);
      setN8nTransformActive(false);

      // Persist draft to session
      if (sessionIdRef.current) {
        void updateN8nSession(sessionIdRef.current, {
          status: 'editing',
          step: 'edit',
          draftJson: JSON.stringify(completedDraft),
        }).catch(() => {});
      }
    },
    [dispatch, setN8nTransformActive],
  );

  const handleSnapshotCompletedNoDraft = useCallback(() => {
    setIsRestoring(false);
    setN8nTransformActive(false);
    try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
    dispatch({
      type: 'TRANSFORM_FAILED',
      error: 'Transform completed but no draft was generated. Please try again.',
    });
  }, [dispatch, setN8nTransformActive]);

  const handleSnapshotFailed = useCallback(
    (error: string) => {
      setIsRestoring(false);
      setN8nTransformActive(false);
      try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
      // Update session status on failure
      if (sessionIdRef.current) {
        void updateN8nSession(sessionIdRef.current, {
          status: 'failed',
          error: error || 'Transform failed',
        }).catch(() => {});
      }
      dispatch({ type: 'TRANSFORM_FAILED', error });
    },
    [dispatch, setN8nTransformActive],
  );

  const handleSnapshotSessionLost = useCallback(() => {
    setIsRestoring(false);
    setN8nTransformActive(false);
    try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
    dispatch({
      type: 'TRANSFORM_FAILED',
      error: 'Transform session lost. The backend may have restarted. Please try again.',
    });
  }, [dispatch, setN8nTransformActive]);

  const handleSnapshotQuestions = useCallback(
    (questions: unknown[]) => {
      // Map raw snapshot questions to the typed TransformQuestion format
      const mapped = questions
        .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
        .map((q) => ({
          id: String(q.id ?? ''),
          category: typeof q.category === 'string' ? q.category : undefined,
          question: String(q.question ?? ''),
          type: (q.type === 'select' || q.type === 'text' || q.type === 'boolean' ? q.type : 'text') as 'select' | 'text' | 'boolean',
          options: Array.isArray(q.options) ? q.options.map(String) : undefined,
          default: typeof q.default === 'string' ? q.default : undefined,
          context: typeof q.context === 'string' ? q.context : undefined,
        }));

      if (mapped.length > 0) {
        dispatch({ type: 'QUESTIONS_GENERATED', questions: mapped });

        // Persist questions to DB session
        if (sessionIdRef.current) {
          void updateN8nSession(sessionIdRef.current, {
            status: 'awaiting_answers',
            questionsJson: JSON.stringify(mapped),
            transformId: state.backgroundTransformId ?? undefined,
          }).catch(() => {});
        }
      } else {
        // No questions — proceed to answering with defaults
        dispatch({ type: 'QUESTIONS_FAILED', error: '' });
      }
    },
    [dispatch, state.backgroundTransformId],
  );

  useBackgroundSnapshot({
    snapshotId: state.backgroundTransformId,
    getSnapshot: getN8nTransformSnapshot,
    onLines: handleSnapshotLines,
    onPhase: handleSnapshotPhase,
    onDraft: handleSnapshotDraft,
    onCompletedNoDraft: handleSnapshotCompletedNoDraft,
    onFailed: handleSnapshotFailed,
    onSessionLost: handleSnapshotSessionLost,
    onQuestions: handleSnapshotQuestions,
    epoch: state.snapshotEpoch,
  });

  // ── Handlers ──

  const processFile = useCallback(
    (file: File) => {
      try {
        if (!file.name.endsWith('.json')) {
          dispatch({ type: 'SET_ERROR', error: 'Please upload a .json file exported from n8n.' });
          return;
        }

        // Reject very large files (> 5MB) that could cause issues
        if (file.size > 5 * 1024 * 1024) {
          dispatch({ type: 'SET_ERROR', error: 'File is too large (max 5MB). Please use a smaller n8n workflow export.' });
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

            let json: unknown;
            try {
              json = JSON.parse(content);
            } catch (parseErr) {
              dispatch({
                type: 'SET_ERROR',
                error: `Invalid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
              });
              return;
            }

            let result;
            try {
              result = parseN8nWorkflow(json);
            } catch (parseErr) {
              dispatch({
                type: 'SET_ERROR',
                error: `Failed to analyze workflow: ${parseErr instanceof Error ? parseErr.message : 'unknown error'}`,
              });
              return;
            }

            // Clear any stale restore state before loading new file
            try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
            void resetTransformStream();
            setIsRestoring(false);

            const workflowName = (json as Record<string, unknown>)?.name;

            const wfName = typeof workflowName === 'string' && workflowName ? workflowName : 'Imported n8n Workflow';
            const rawJson = JSON.stringify(json);

            dispatch({
              type: 'FILE_PARSED',
              workflowName: wfName,
              rawWorkflowJson: rawJson,
              parsedResult: result,
            });

            // Persist session to DB
            createN8nSession(wfName, rawJson, 'analyze', 'draft')
              .then((session) => {
                dispatch({ type: 'SESSION_CREATED', sessionId: session.id });
                // Save parser result to session
                void updateN8nSession(session.id, {
                  parserResult: JSON.stringify(result),
                });
              })
              .catch(() => { /* non-critical — wizard still works without persistence */ });
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
    [dispatch],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileDrop = useCallback(
    (file: File) => {
      processFile(file);
    },
    [processFile],
  );

  const handleTransform = async () => {
    if (!state.parsedResult || !state.rawWorkflowJson || state.transforming || state.confirming) return;

    try {
      const transformId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      // Determine if this is an adjustment re-run or initial
      const isAdjustment = !!state.adjustmentRequest.trim() || !!state.draft;
      const subPhase = isAdjustment ? 'generating' as const : 'asking' as const;

      setIsRestoring(false);
      setAnalyzing(true);
      await startTransformStream(transformId);
      dispatch({ type: 'TRANSFORM_STARTED', transformId, subPhase });
      setN8nTransformActive(true);
      setAnalyzing(false);

      // Update session status and persist transform_id
      if (state.sessionId) {
        void updateN8nSession(state.sessionId, { status: 'transforming', step: 'transform', transformId }).catch(() => {});
      }

      const previousDraftJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim() || null;

      // Persist context for restore
      try {
        const context: PersistedTransformContext = {
          transformId,
          workflowName: state.workflowName || 'Imported n8n Workflow',
          rawWorkflowJson: state.rawWorkflowJson,
          parsedResult: state.parsedResult!,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(N8N_TRANSFORM_CONTEXT_KEY, JSON.stringify(context));
      } catch {
        // localStorage might be full - continue without persistence
      }

      // Serialize parser result without pretty-print to reduce IPC payload size
      let parserJson: string;
      try {
        parserJson = JSON.stringify(state.parsedResult);
      } catch {
        parserJson = '{}';
      }

      // Serialize connector context for the transform prompt
      const storeState = usePersonaStore.getState();
      const connectorsJson = JSON.stringify(
        storeState.connectorDefinitions.map((c) => ({ name: c.name, label: c.label })),
      );
      const credentialsJson = JSON.stringify(
        storeState.credentials.map((c) => ({ name: c.name, service_type: c.service_type })),
      );

      // Serialize user answers from configure step
      const userAnswersJson = Object.keys(state.userAnswers).length > 0
        ? JSON.stringify(state.userAnswers)
        : null;

      await startN8nTransformBackground(
        transformId,
        state.workflowName || 'Imported n8n Workflow',
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
      setAnalyzing(false);
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

      // Send the original payloadJson (not stringifyDraft(normalized)) to preserve entity arrays
      // (triggers, tools, required_connectors) that normalizeDraftFromUnknown does not copy.
      const response = await confirmN8nPersonaDraft(payloadJson);
      await fetchPersonas();
      selectPersona(response.persona.id);

      // Extract entity creation results
      const responseObj = response as Record<string, unknown>;
      setConfirmResult({
        triggersCreated: typeof responseObj.triggers_created === 'number' ? responseObj.triggers_created : 0,
        toolsCreated: typeof responseObj.tools_created === 'number' ? responseObj.tools_created : 0,
        connectorsNeedingSetup: Array.isArray(responseObj.connectors_needing_setup)
          ? (responseObj.connectors_needing_setup as string[])
          : [],
      });

      dispatch({ type: 'CONFIRM_COMPLETED' });

      // Delete completed session from DB (no longer needed)
      if (state.sessionId) {
        void deleteN8nSession(state.sessionId).catch(() => {});
      }

      if (state.backgroundTransformId) {
        void clearN8nTransformSnapshot(state.backgroundTransformId).catch(() => {});
      }
      try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
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
      await startTestStream(testId);
      await testN8nDraft(testId, stringifyDraft(state.draft));
    } catch (err) {
      dispatch({ type: 'TEST_FAILED', error: err instanceof Error ? err.message : 'Test failed' });
    }
  };

  const handleCancelTransform = async () => {
    try {
      const transformId = state.backgroundTransformId || currentTransformId;
      if (transformId) {
        try {
          await cancelN8nTransform(transformId);
        } catch {
          // Fallback: just clear the snapshot if cancel command fails
          void clearN8nTransformSnapshot(transformId).catch(() => {});
        }
      }
      try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
      void resetTransformStream();
      setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'TRANSFORM_CANCELLED' });
    } catch {
      // Ensure we always reset UI state even if cancel fails
      setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'TRANSFORM_CANCELLED' });
    }
  };

  const handleReset = () => {
    try {
      const snapshotId = state.backgroundTransformId || currentTransformId;
      if (snapshotId) {
        void clearN8nTransformSnapshot(snapshotId).catch(() => {});
      }
      try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
      void resetTransformStream();
      void resetTestStream();
      setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'RESET' });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      // Ensure reset always works
      setN8nTransformActive(false);
      dispatch({ type: 'RESET' });
    }
  };

  const updateDraft = useCallback(
    (updater: (current: import('@/api/n8nTransform').N8nPersonaDraft) => import('@/api/n8nTransform').N8nPersonaDraft) => {
      if (!state.draft) return;
      dispatch({ type: 'DRAFT_UPDATED', draft: updater(state.draft) });
    },
    [state.draft, dispatch],
  );

  // ── Continue transform (Turn 2: submit answers) ──

  const handleContinueTransform = async () => {
    if (!state.backgroundTransformId) return;

    try {
      dispatch({ type: 'TRANSFORM_STARTED', transformId: state.backgroundTransformId, subPhase: 'generating' });
      setN8nTransformActive(true);
      await startTransformStream(state.backgroundTransformId);

      const userAnswersJson = Object.keys(state.userAnswers).length > 0
        ? JSON.stringify(state.userAnswers)
        : '{}';

      await continueN8nTransform(
        state.backgroundTransformId,
        userAnswersJson,
        state.sessionId,
      );

      if (state.sessionId) {
        void updateN8nSession(state.sessionId, {
          status: 'transforming',
          step: 'transform',
          userAnswers: userAnswersJson,
        }).catch(() => {});
      }
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
        // Directly start the unified transform (Turn 1: analyze + maybe ask questions)
        void handleTransform();
        break;
      case 'transform':
        if (state.transformSubPhase === 'answering') {
          // User answered questions — submit answers (Turn 2)
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

  // ── Render ──

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator - hidden on upload */}
      {state.step !== 'upload' && (
        <div className="px-6 pt-4 pb-1 border-b border-primary/5">
          <N8nStepIndicator currentStep={state.step} />
        </div>
      )}

      {/* Error banner — suppress on transform step (errors shown inline in chat) */}
      {state.error && state.step !== 'transform' && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mt-3 flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20"
        >
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-400 font-medium">Import Error</p>
            <p className="text-sm text-red-400/70 mt-0.5">{state.error}</p>
          </div>
          <button
            onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
            className="text-red-400/50 hover:text-red-400 text-sm"
          >
            Dismiss
          </button>
        </motion.div>
      )}

      {/* Step content */}
      <div className={`flex-1 min-h-0 ${state.step === 'edit' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={state.step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={`p-6 ${state.step === 'edit' ? 'h-full' : ''}`}
          >
            {state.step === 'upload' && (
              <>
                <N8nUploadStep
                  fileInputRef={fileInputRef}
                  onFileSelect={handleFileSelect}
                  onFileDrop={handleFileDrop}
                />
                <div className="mt-6">
                  <N8nSessionList
                    onLoadSession={(sessionId, step, workflowName, rawWorkflowJson, parsedResult, draft, questions, transformId, userAnswers) => {
                      dispatch({
                        type: 'SESSION_LOADED',
                        sessionId,
                        step,
                        workflowName,
                        rawWorkflowJson,
                        parsedResult,
                        draft,
                        questions,
                        transformId,
                        userAnswers,
                      });
                    }}
                  />
                </div>
              </>
            )}

            {state.step === 'analyze' && state.parsedResult && (
              <N8nParserResults
                parsedResult={state.parsedResult}
                workflowName={state.workflowName}
                onReset={handleReset}
                selectedToolIndices={state.selectedToolIndices}
                selectedTriggerIndices={state.selectedTriggerIndices}
                selectedConnectorNames={state.selectedConnectorNames}
                onToggleTool={(i) => dispatch({ type: 'TOGGLE_TOOL', index: i })}
                onToggleTrigger={(i) => dispatch({ type: 'TOGGLE_TRIGGER', index: i })}
                onToggleConnector={(n) => dispatch({ type: 'TOGGLE_CONNECTOR', name: n })}
                isAnalyzing={analyzing}
              />
            )}

            {state.step === 'transform' && (
              <N8nTransformChat
                transformSubPhase={state.transformSubPhase}
                questions={state.questions}
                userAnswers={state.userAnswers}
                onAnswerUpdated={(questionId, answer) =>
                  dispatch({ type: 'ANSWER_UPDATED', questionId, answer })
                }
                transformPhase={state.transformPhase}
                transformLines={state.transformLines}
                runId={currentTransformId}
                isRestoring={isRestoring}
                onRetry={() => void handleTransform()}
                onCancel={() => void handleCancelTransform()}
              />
            )}

            {state.step === 'edit' && state.draft && (
              <N8nEditStep
                draft={state.draft}
                draftJson={state.draftJson}
                draftJsonError={state.draftJsonError}
                parsedResult={state.parsedResult!}
                selectedToolIndices={state.selectedToolIndices}
                selectedTriggerIndices={state.selectedTriggerIndices}
                selectedConnectorNames={state.selectedConnectorNames}
                adjustmentRequest={state.adjustmentRequest}
                transforming={state.transforming}
                disabled={state.transforming || state.confirming || state.created}
                updateDraft={updateDraft}
                onDraftUpdated={(d) => dispatch({ type: 'DRAFT_UPDATED', draft: d })}
                onJsonEdited={(json, draft, error) => dispatch({ type: 'DRAFT_JSON_EDITED', json, draft, error })}
                onAdjustmentChange={(text) => dispatch({ type: 'SET_ADJUSTMENT', text })}
                onApplyAdjustment={() => void handleTransform()}
                onGoToAnalyze={() => dispatch({ type: 'GO_TO_STEP', step: 'analyze' })}
                onConnectorsMissingChange={setConnectorsMissing}
                testPhase={state.testPhase}
                testLines={state.testLines}
                testRunId={state.testRunId}
                onTestUseCase={() => void handleTestDraft()}
                testingUseCaseId={state.testStatus === 'running' ? '__testing__' : null}
              />
            )}

            {state.step === 'confirm' && state.draft && (
              <N8nConfirmStep
                draft={state.draft}
                parsedResult={state.parsedResult!}
                selectedToolIndices={state.selectedToolIndices}
                selectedTriggerIndices={state.selectedTriggerIndices}
                selectedConnectorNames={state.selectedConnectorNames}
                created={state.created}
                confirmResult={confirmResult}
                onReset={handleReset}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer navigation */}
      <N8nWizardFooter
        step={state.step}
        canGoBack={canGoBack}
        onBack={goBack}
        onNext={handleNext}
        transforming={state.transforming}
        confirming={state.confirming}
        created={state.created}
        hasDraft={!!state.draft}
        hasParseResult={!!state.parsedResult}
        transformSubPhase={state.transformSubPhase}
        analyzing={analyzing}
        connectorsMissing={connectorsMissing}
        testStatus={state.testStatus}
        testError={state.testError}
        onTest={() => void handleTestDraft()}
        onApplyAdjustment={() => void handleTransform()}
      />
    </div>
  );
}
