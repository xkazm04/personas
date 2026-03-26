import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/lib/log';

const logger = createLogger('n8n-transform');
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { useBackgroundSnapshot } from '@/hooks/utility/data/useBackgroundSnapshot';
import { usePersistedContext } from '@/hooks/utility/data/usePersistedContext';
import {
  getN8nTransformSnapshot,
} from '@/api/templates/n8nTransform';
import type { N8nPersonaDraft, StreamingSection, SectionKind, SectionValidation } from '@/api/templates/n8nTransform';
import {
  normalizeDraft,
  normalizeDraftFromUnknown,
  N8N_TRANSFORM_CONTEXT_KEY,
  TRANSFORM_CONTEXT_MAX_AGE_MS,
  type PersistedTransformContext,
} from './n8nTypes';
import type { N8nImportAction, TransformQuestion } from './useN8nImportReducer';

// Color presets -- synced with ColorPicker.tsx
const COLOR_PRESETS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7',
];

export interface N8nTransformApi {
  /** Current transform run ID from the CLI stream */
  currentTransformId: string | null;
  /** Whether we're restoring an in-flight context on mount */
  isRestoring: boolean;
  setIsRestoring: (v: boolean) => void;
  /** Whether the analyze-to-transform transition is in progress */
  analyzing: boolean;
  setAnalyzing: (v: boolean) => void;
  /** Start listening for transform CLI events */
  startTransformStream: (id: string) => Promise<void>;
  /** Reset the transform CLI stream */
  resetTransformStream: () => Promise<void>;
  /** Override stream lines (used by snapshot sync) */
  setStreamLines: (lines: string[]) => void;
  /** Override stream phase (used by snapshot sync) */
  setStreamPhase: (phase: 'idle' | 'running' | 'completed' | 'failed') => void;
}

/**
 * Manages the transform CLI stream, background snapshot polling, and
 * persisted-context restoration for the n8n import wizard.
 *
 * Dispatches to the reducer on snapshot events -- the useN8nSession hook
 * auto-syncs reducer state to DB and localStorage, so no manual
 * session.update() calls are needed here.
 */
export function useN8nTransform(
  backgroundTransformId: string | null,
  snapshotEpoch: number,
  dispatch: React.Dispatch<N8nImportAction>,
  clearPersistedContext: () => void,
  setN8nTransformActive: (active: boolean) => void,
): N8nTransformApi {
  const [isRestoring, setIsRestoring] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Ref to backgroundTransformId for use in stable callbacks
  const transformIdRef = useRef(backgroundTransformId);
  transformIdRef.current = backgroundTransformId;

  // -- CLI stream for transform events --

  const {
    runId: currentTransformId,
    start: startTransformStream,
    reset: resetTransformStream,
    setLines: setStreamLines,
    setPhase: setStreamPhase,
  } = useCorrelatedCliStream({
    outputEvent: EventName.N8N_TRANSFORM_OUTPUT,
    statusEvent: EventName.N8N_TRANSFORM_STATUS,
    idField: 'transform_id',
    onFailed: (message) => {
      clearPersistedContext();
      dispatch({ type: 'TRANSFORM_FAILED', error: message });
    },
  });

  // -- Restore persisted context on mount --

  const handleRestoreContext = useCallback(
    (parsed: PersistedTransformContext) => {
      setIsRestoring(true);
      dispatch({
        type: 'RESTORE_CONTEXT',
        transformId: parsed.transformId,
        workflowName: parsed.workflowName || 'Imported Workflow',
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

  // -- Snapshot handlers --
  // These only dispatch to reducer -- DB/localStorage sync is handled by useN8nSession.

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
    (draft: N8nPersonaDraft) => {
      const normalized = normalizeDraftFromUnknown(draft);
      if (!normalized || !normalized.system_prompt.trim()) {
        setIsRestoring(false);
        setN8nTransformActive(false);
        clearPersistedContext();
        dispatch({
          type: 'TRANSFORM_FAILED',
          error: 'Transform output was invalid. Please retry or refine your request.',
        });
        return;
      }

      let completedDraft = normalizeDraft(normalized);
      // Apply a random color if the transform didn't set one
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
    },
    [dispatch, resetTransformStream, setN8nTransformActive],
  );

  const handleSnapshotCompletedNoDraft = useCallback(() => {
    setIsRestoring(false);
    setN8nTransformActive(false);
    clearPersistedContext();
    dispatch({
      type: 'TRANSFORM_FAILED',
      error: 'Transform completed but no draft was generated. Please try again.',
    });
  }, [dispatch, setN8nTransformActive, clearPersistedContext]);

  const handleSnapshotFailed = useCallback(
    (error: string) => {
      setIsRestoring(false);
      setN8nTransformActive(false);
      clearPersistedContext();
      dispatch({ type: 'TRANSFORM_FAILED', error });
    },
    [dispatch, setN8nTransformActive, clearPersistedContext],
  );

  const handleSnapshotSessionLost = useCallback(() => {
    setIsRestoring(false);
    setN8nTransformActive(false);
    clearPersistedContext();
    dispatch({
      type: 'TRANSFORM_FAILED',
      error: 'Transform session lost. The backend may have restarted. Please try again.',
    });
  }, [dispatch, setN8nTransformActive, clearPersistedContext]);

  const handleSnapshotQuestions = useCallback(
    (questions: unknown[]) => {
      const mapped: TransformQuestion[] = questions
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

      // CLI process has stopped -- waiting for user input, not actively running
      setN8nTransformActive(false);

      if (mapped.length > 0) {
        dispatch({ type: 'QUESTIONS_GENERATED', questions: mapped });
      } else {
        dispatch({ type: 'QUESTIONS_FAILED', error: '' });
      }
    },
    [dispatch, setN8nTransformActive],
  );

  const handleSnapshotSections = useCallback(
    (sections: unknown[]) => {
      const mapped: StreamingSection[] = sections
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          kind: String(s.kind ?? 'identity') as SectionKind,
          index: typeof s.index === 'number' ? s.index : 0,
          label: String(s.label ?? ''),
          data: (s.data && typeof s.data === 'object' ? s.data : {}) as Record<string, unknown>,
          validation: (s.validation && typeof s.validation === 'object'
            ? s.validation
            : { valid: true, errors: [], warnings: [] }) as SectionValidation,
        }));
      if (mapped.length > 0) {
        dispatch({ type: 'TRANSFORM_SECTIONS', sections: mapped });
      }
    },
    [dispatch],
  );

  // -- Push-based section events (instant delivery) --

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    listen<{ transformId: string; section: Record<string, unknown> }>(
      EventName.N8N_TRANSFORM_SECTION,
      (event) => {
        const { transformId: tid, section: s } = event.payload;
        if (tid !== transformIdRef.current) return;
        if (!s || typeof s !== 'object') return;
        const mapped: StreamingSection = {
          kind: String(s.kind ?? 'identity') as SectionKind,
          index: typeof s.index === 'number' ? s.index : 0,
          label: String(s.label ?? ''),
          data: (s.data && typeof s.data === 'object' ? s.data : {}) as Record<string, unknown>,
          validation: (s.validation && typeof s.validation === 'object'
            ? s.validation
            : { valid: true, errors: [], warnings: [] }) as SectionValidation,
        };
        dispatch({ type: 'TRANSFORM_SECTION_PUSH', section: mapped });
      },
    ).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch((err) => {
      logger.warn('Failed to listen for section events', { err });
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [dispatch]);

  // -- Background snapshot polling (fallback for session restoration) --

  useBackgroundSnapshot({
    snapshotId: backgroundTransformId,
    getSnapshot: getN8nTransformSnapshot,
    onLines: handleSnapshotLines,
    onPhase: handleSnapshotPhase,
    onDraft: handleSnapshotDraft,
    onCompletedNoDraft: handleSnapshotCompletedNoDraft,
    onFailed: handleSnapshotFailed,
    onSessionLost: handleSnapshotSessionLost,
    onQuestions: handleSnapshotQuestions,
    onSections: handleSnapshotSections,
    epoch: snapshotEpoch,
  });

  return {
    currentTransformId,
    isRestoring,
    setIsRestoring,
    analyzing,
    setAnalyzing,
    startTransformStream,
    resetTransformStream,
    setStreamLines,
    setStreamPhase,
  };
}
