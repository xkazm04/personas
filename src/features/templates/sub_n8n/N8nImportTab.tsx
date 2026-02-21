import { useCallback, useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { parseN8nWorkflow } from '@/lib/personas/n8nParser';
import {
  cancelN8nTransform,
  clearN8nTransformSnapshot,
  confirmN8nPersonaDraft,
  generateN8nTransformQuestions,
  getN8nTransformSnapshot,
  startN8nTransformBackground,
  createN8nSession,
  updateN8nSession,
} from '@/api/tauriApi';
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
  const pollTimerRef = useRef<number | null>(null);
  const prevStepRef = useRef(STEP_META[state.step].index);
  const hasRestoredRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);

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
    lineField: 'line',
    statusField: 'status',
    errorField: 'error',
    onFailed: (message) => dispatch({ type: 'TRANSFORM_FAILED', error: message }),
  });

  // ── Restore persisted context on mount ──

  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const raw = window.localStorage.getItem(N8N_TRANSFORM_CONTEXT_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as PersistedTransformContext;
      if (!parsed?.transformId) {
        window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY);
        return;
      }

      // Discard stale contexts (older than 10 minutes)
      if (parsed.savedAt && Date.now() - parsed.savedAt > TRANSFORM_CONTEXT_MAX_AGE_MS) {
        window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY);
        return;
      }

      setIsRestoring(true);
      dispatch({
        type: 'RESTORE_CONTEXT',
        transformId: parsed.transformId,
        workflowName: parsed.workflowName || 'Imported n8n Workflow',
        rawWorkflowJson: parsed.rawWorkflowJson || '',
        parsedResult: parsed.parsedResult || null,
      });

      void startTransformStream(parsed.transformId);
    } catch {
      window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY);
    }
  }, [startTransformStream, dispatch]);

  // ── Poll for snapshot updates ──

  const notFoundCountRef = useRef(0);

  useEffect(() => {
    if (!state.backgroundTransformId) return;

    notFoundCountRef.current = 0;

    const syncSnapshot = async () => {
      try {
        const snapshot = await getN8nTransformSnapshot(state.backgroundTransformId!);
        notFoundCountRef.current = 0;

        const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
        dispatch({ type: 'TRANSFORM_LINES', lines });
        setStreamLines(lines);

        if (snapshot.status === 'running' || snapshot.status === 'completed' || snapshot.status === 'failed') {
          dispatch({ type: 'TRANSFORM_PHASE', phase: snapshot.status });
          setStreamPhase(snapshot.status);
        }

        if (snapshot.draft) {
          let completedDraft: import('@/api/design').N8nPersonaDraft;
          try {
            completedDraft = normalizeDraft(snapshot.draft);
          } catch {
            completedDraft = snapshot.draft;
          }
          dispatch({ type: 'TRANSFORM_COMPLETED', draft: completedDraft });
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
        } else if (snapshot.status === 'completed') {
          // Status completed but no draft — draft serialization may have failed
          setIsRestoring(false);
          setN8nTransformActive(false);
          try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
          dispatch({
            type: 'TRANSFORM_FAILED',
            error: 'Transform completed but no draft was generated. Please try again.',
          });
        }

        if (snapshot.status === 'failed') {
          setIsRestoring(false);
          setN8nTransformActive(false);
          try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
          // Update session status on failure
          if (sessionIdRef.current) {
            void updateN8nSession(sessionIdRef.current, {
              status: 'failed',
              error: snapshot.error ?? 'Transform failed',
            }).catch(() => {});
          }
          if (snapshot.error) {
            dispatch({ type: 'TRANSFORM_FAILED', error: snapshot.error });
          }
        }

        // Stop polling once we reach a terminal state
        if (snapshot.status === 'completed' || snapshot.status === 'failed') {
          if (pollTimerRef.current !== null) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          return;
        }

        if (snapshot.status === 'running') return;
      } catch {
        // Snapshot not found - backend may have restarted
        notFoundCountRef.current += 1;
        if (notFoundCountRef.current >= 3) {
          // After 3 consecutive failures (~4.5s), treat as stale
          setIsRestoring(false);
          setN8nTransformActive(false);
          try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* ignore */ }
          dispatch({
            type: 'TRANSFORM_FAILED',
            error: 'Transform session lost. The backend may have restarted. Please try again.',
          });
        }
      }
    };

    void syncSnapshot();

    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    pollTimerRef.current = window.setInterval(() => {
      void syncSnapshot();
    }, 1500);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [state.backgroundTransformId, dispatch, setStreamLines, setStreamPhase]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

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

      setIsRestoring(false);
      await startTransformStream(transformId);
      dispatch({ type: 'TRANSFORM_STARTED', transformId });
      setN8nTransformActive(true);

      // Update session status
      if (state.sessionId) {
        void updateN8nSession(state.sessionId, { status: 'transforming', step: 'transform' }).catch(() => {});
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
      setN8nTransformActive(false);
      dispatch({
        type: 'TRANSFORM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to generate transformation draft.',
      });
    }
  };

  const handleConfirmSave = async () => {
    try {
      const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
      if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

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

      const response = await confirmN8nPersonaDraft(stringifyDraft(normalized));
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

      // Mark session as confirmed
      if (state.sessionId) {
        void updateN8nSession(state.sessionId, {
          status: 'confirmed',
          step: 'confirm',
          personaId: response.persona.id,
        }).catch(() => {});
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
    (updater: (current: import('@/api/design').N8nPersonaDraft) => import('@/api/design').N8nPersonaDraft) => {
      if (!state.draft) return;
      dispatch({ type: 'DRAFT_UPDATED', draft: updater(state.draft) });
    },
    [state.draft, dispatch],
  );

  // ── Question generation ──

  const handleGenerateQuestions = async () => {
    if (!state.parsedResult || !state.rawWorkflowJson) return;

    dispatch({ type: 'QUESTIONS_GENERATING' });

    // Update session to reflect transform step (question sub-phase)
    if (state.sessionId) {
      void updateN8nSession(state.sessionId, { status: 'analyzing', step: 'transform' }).catch(() => {});
    }

    try {
      const storeState = usePersonaStore.getState();
      const connectorsJson = JSON.stringify(
        storeState.connectorDefinitions.map((c) => ({ name: c.name, label: c.label })),
      );
      const credentialsJson = JSON.stringify(
        storeState.credentials.map((c) => ({ name: c.name, service_type: c.service_type })),
      );

      const questions = await generateN8nTransformQuestions(
        state.workflowName,
        state.rawWorkflowJson,
        JSON.stringify(state.parsedResult),
        connectorsJson,
        credentialsJson,
      );

      // Normalize response — backend returns serde_json::Value which may be a raw array
      const questionsArray = Array.isArray(questions) ? questions : [];
      dispatch({ type: 'QUESTIONS_GENERATED', questions: questionsArray });

      // Update session step
      if (state.sessionId) {
        void updateN8nSession(state.sessionId, { step: 'transform' }).catch(() => {});
      }
    } catch (err) {
      // On failure, stay on transform step — user can still generate with defaults
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      dispatch({
        type: 'QUESTIONS_FAILED',
        error: msg || 'Configuration questions could not be generated. You can generate with defaults.',
      });

      // Persist failure to session
      if (state.sessionId) {
        void updateN8nSession(state.sessionId, {
          status: 'failed',
          error: msg || 'Question generation failed',
        }).catch(() => {});
      }
    }
  };

  // ── Next step handler ──

  const handleSkipToTransform = () => {
    dispatch({ type: 'QUESTIONS_SKIPPED' });
  };

  const handleNext = () => {
    switch (state.step) {
      case 'analyze':
        void handleGenerateQuestions();
        break;
      case 'transform':
        if (state.transformSubPhase === 'answering') {
          void handleTransform();
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
            <p className="text-xs text-red-400/70 mt-0.5">{state.error}</p>
          </div>
          <button
            onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
            className="text-red-400/50 hover:text-red-400 text-xs"
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
                    onLoadSession={(sessionId, step, workflowName, rawWorkflowJson, parsedResult, draft) => {
                      dispatch({
                        type: 'SESSION_LOADED',
                        sessionId,
                        step,
                        workflowName,
                        rawWorkflowJson,
                        parsedResult,
                        draft,
                      });
                    }}
                  />
                </div>
              </>
            )}

            {state.step === 'analyze' && state.parsedResult && (
              <>
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
                />
                {!state.transforming && !state.questionGenerating && (
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={handleSkipToTransform}
                      className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                    >
                      Skip configuration &amp; transform directly &rarr;
                    </button>
                  </div>
                )}
              </>
            )}

            {state.step === 'transform' && (
              <N8nTransformChat
                transformSubPhase={state.transformSubPhase}
                questions={state.questions}
                questionsSkipped={state.questionsSkipped}
                userAnswers={state.userAnswers}
                onAnswerUpdated={(questionId, answer) =>
                  dispatch({ type: 'ANSWER_UPDATED', questionId, answer })
                }
                onSkipQuestions={() => dispatch({ type: 'QUESTIONS_SKIPPED' })}
                transformPhase={state.transformPhase}
                transformLines={state.transformLines}
                runId={currentTransformId}
                isRestoring={isRestoring}
                onRetry={() => void handleTransform()}
                onCancel={() => void handleCancelTransform()}
                error={state.error}
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
        questionGenerating={state.questionGenerating}
        transformSubPhase={state.transformSubPhase}
      />
    </div>
  );
}
