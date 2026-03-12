import { useCallback, useRef, useEffect } from 'react';
import {
  createN8nSession,
  updateN8nSession,
  deleteN8nSession,
} from '@/api/templates/n8nTransform';
import {
  N8N_TRANSFORM_CONTEXT_KEY,
  type PersistedTransformContext,
} from './n8nTypes';
import { useToastStore } from '@/stores/toastStore';
import type { N8nImportState, N8nImportAction } from './useN8nImportReducer';

// -- Derived status from reducer state --

function deriveSessionStatus(state: N8nImportState): string {
  if (state.created) return 'confirmed';
  if (state.transforming) return 'transforming';
  if (state.transformSubPhase === 'answering') return 'awaiting_answers';
  if (state.step === 'edit' || state.step === 'confirm') return 'editing';
  if (state.error) return 'failed';
  return 'draft';
}

// -- Slices for diffing (only sync when these actually change) --

interface DbSlice {
  step: string;
  status: string;
  parserResult: string | null;
  draftJson: string | null;
  questionsJson: string | null;
  userAnswers: string | null;
  transformId: string | null;
  error: string | null;
}

function deriveDbSlice(state: N8nImportState): DbSlice {
  return {
    step: state.step,
    status: deriveSessionStatus(state),
    parserResult: state.parsedResult ? JSON.stringify(state.parsedResult) : null,
    draftJson: state.draft ? JSON.stringify(state.draft) : null,
    questionsJson: state.questions ? JSON.stringify(state.questions) : null,
    userAnswers: Object.keys(state.userAnswers).length > 0 ? JSON.stringify(state.userAnswers) : null,
    transformId: state.backgroundTransformId,
    error: state.error,
  };
}

function slicesEqual(a: DbSlice, b: DbSlice): boolean {
  return a.step === b.step
    && a.status === b.status
    && a.parserResult === b.parserResult
    && a.draftJson === b.draftJson
    && a.questionsJson === b.questionsJson
    && a.userAnswers === b.userAnswers
    && a.transformId === b.transformId
    && a.error === b.error;
}

// -- Public API --

export interface N8nSessionApi {
  /** Ref to the current sessionId for async closures */
  sessionIdRef: React.RefObject<string | null>;
  /** Remove persisted transform context from localStorage */
  clearPersistedContext: () => void;
  /** Create a new session; dispatches SESSION_CREATED and returns the session ID */
  create: (workflowName: string, rawJson: string) => Promise<string | null>;
  /** Fire-and-forget delete of the current session */
  remove: () => void;
}

const DB_SYNC_DELAY = 600;
const LS_SYNC_DELAY = 300;

/**
 * Watches reducer state slices and auto-syncs to both SQLite (via Tauri)
 * and localStorage through debounced writes. The reducer is the sole
 * source of truth -- DB and localStorage become read-on-mount,
 * write-on-change persistence layers.
 */
export function useN8nSession(
  state: N8nImportState,
  dispatch: React.Dispatch<N8nImportAction>,
): N8nSessionApi {
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = state.sessionId;

  // Track last-synced slice to avoid redundant writes
  const lastSyncedSliceRef = useRef<DbSlice | null>(null);
  const dbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  // -- Auto-sync to SQLite (debounced) --

  useEffect(() => {
    const id = state.sessionId;
    if (!id) return;

    // Skip initial state / reset state
    if (state.step === 'upload' && !state.parsedResult && !state.draft) return;

    const currentSlice = deriveDbSlice(state);
    if (lastSyncedSliceRef.current && slicesEqual(lastSyncedSliceRef.current, currentSlice)) return;

    if (dbTimerRef.current) clearTimeout(dbTimerRef.current);
    dbTimerRef.current = setTimeout(() => {
      dbTimerRef.current = null;
      // Read the freshest state at write time to avoid syncing a stale snapshot
      const freshSlice = deriveDbSlice(latestStateRef.current);
      const freshId = latestStateRef.current.sessionId;
      if (!freshId) return;
      if (lastSyncedSliceRef.current && slicesEqual(lastSyncedSliceRef.current, freshSlice)) return;
      void (async () => {
        try {
          await updateN8nSession(freshId, {
            step: freshSlice.step,
            status: freshSlice.status,
            parserResult: freshSlice.parserResult,
            draftJson: freshSlice.draftJson,
            questionsJson: freshSlice.questionsJson,
            userAnswers: freshSlice.userAnswers,
            transformId: freshSlice.transformId,
            error: freshSlice.error,
          });
          lastSyncedSliceRef.current = freshSlice;
        } catch {
          // intentional: non-critical -- DB sync will be retried on next state change
        }
      })();
    }, DB_SYNC_DELAY);

    return () => {
      if (dbTimerRef.current) {
        clearTimeout(dbTimerRef.current);
        dbTimerRef.current = null;
      }
    };
  }, [
    state.sessionId,
    state.step,
    state.parsedResult,
    state.draft,
    state.questions,
    state.userAnswers,
    state.backgroundTransformId,
    state.error,
    state.transforming,
    state.transformSubPhase,
    state.created,
  ]);

  // -- Auto-sync to localStorage (debounced) -- only during active transform --

  useEffect(() => {
    if (!state.transforming || !state.backgroundTransformId || !state.rawWorkflowJson) {
      return;
    }

    if (lsTimerRef.current) clearTimeout(lsTimerRef.current);
    lsTimerRef.current = setTimeout(() => {
      lsTimerRef.current = null;
      try {
        const context: PersistedTransformContext = {
          transformId: state.backgroundTransformId!,
          workflowName: state.workflowName || 'Imported Workflow',
          rawWorkflowJson: state.rawWorkflowJson,
          parsedResult: state.parsedResult!,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(N8N_TRANSFORM_CONTEXT_KEY, JSON.stringify(context));
      } catch {
        // intentional: non-critical -- localStorage cleanup
      }
    }, LS_SYNC_DELAY);

    return () => {
      if (lsTimerRef.current) {
        clearTimeout(lsTimerRef.current);
        lsTimerRef.current = null;
      }
    };
  }, [
    state.transforming,
    state.backgroundTransformId,
    state.workflowName,
    state.rawWorkflowJson,
    state.parsedResult,
  ]);

  // -- Cleanup timers on unmount --

  useEffect(() => {
    return () => {
      const current = latestStateRef.current;

      if (dbTimerRef.current) {
        clearTimeout(dbTimerRef.current);
        dbTimerRef.current = null;
        if (current.sessionId) {
          const currentSlice = deriveDbSlice(current);
          void updateN8nSession(current.sessionId, {
            step: currentSlice.step,
            status: currentSlice.status,
            parserResult: currentSlice.parserResult,
            draftJson: currentSlice.draftJson,
            questionsJson: currentSlice.questionsJson,
            userAnswers: currentSlice.userAnswers,
            transformId: currentSlice.transformId,
            error: currentSlice.error,
          }).catch(() => {});
        }
      }

      if (lsTimerRef.current) {
        clearTimeout(lsTimerRef.current);
        lsTimerRef.current = null;
        if (current.transforming && current.backgroundTransformId && current.rawWorkflowJson && current.parsedResult) {
          try {
            const context: PersistedTransformContext = {
              transformId: current.backgroundTransformId,
              workflowName: current.workflowName || 'Imported Workflow',
              rawWorkflowJson: current.rawWorkflowJson,
              parsedResult: current.parsedResult,
              savedAt: Date.now(),
            };
            window.localStorage.setItem(N8N_TRANSFORM_CONTEXT_KEY, JSON.stringify(context));
          } catch {
            // intentional: non-critical -- localStorage cleanup
          }
        }
      }
    };
  }, []);

  // -- Manual operations --

  const clearPersistedContext = useCallback(() => {
    try { window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY); } catch { /* intentional: non-critical -- localStorage cleanup */ }
  }, []);

  const create = useCallback(async (workflowName: string, rawJson: string): Promise<string | null> => {
    try {
      const session = await createN8nSession(workflowName, rawJson, 'analyze', 'draft');
      dispatch({ type: 'SESSION_CREATED', sessionId: session.id });
      sessionIdRef.current = session.id;
      return session.id;
    } catch {
      useToastStore.getState().addToast('Failed to create import session', 'error');
      return null;
    }
  }, [dispatch]);

  const remove = useCallback(() => {
    const id = sessionIdRef.current;
    if (!id) return;
    void deleteN8nSession(id).catch(() => {});
  }, []);

  return { sessionIdRef, clearPersistedContext, create, remove };
}
