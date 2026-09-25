import { useCallback, useEffect, useRef } from 'react';
import { useTauriStream, type TauriStreamActions, type TauriStreamErrorKind } from './useTauriStream';
import { artifactDeadlineMs } from './artifactJobCorrelator';
import { defaultGetLine, buildResolveStatus } from '../template/useAiArtifactFlow';
import type { SystemOperationType } from '@/lib/execution/pipeline';
import { SystemTraceSession } from '@/lib/execution/systemTrace';

// -- Types -------------------------------------------------------

/**
 * Streamlined configuration for an AI artifact task.
 *
 * Unlike `useAiArtifactFlow`, this absorbs the cancel function, uses
 * standard `defaultGetLine` + `buildResolveStatus` by default, and
 * provides a flat config surface so consumers don't need boilerplate
 * `useCallback` wrappers for cancel or `buildResolveStatus` calls.
 *
 * @template TArgs   - tuple of arguments passed to `start()`
 * @template TResult - the structured artifact the AI produces
 */
export interface AiArtifactTaskConfig<TArgs extends unknown[], TResult> {
  /** Tauri event name for progress/output lines. */
  progressEvent: string;
  /** Tauri event name for status transitions. */
  statusEvent: string;
  /** Phase while the stream is running (set on start). */
  runningPhase: string;
  /** Phase to transition to when the task completes successfully. */
  completedPhase: string;
  /** Invoke the Tauri backend command to start the task. */
  startFn: (...args: TArgs) => Promise<unknown>;
  /** Invoke the Tauri backend command to cancel the task. Optional. */
  cancelFn?: () => Promise<unknown>;
  /** Default error message when start() throws. */
  errorMessage?: string;
  /** Timeout in ms. Default: 5 minutes. Ignored when `backendTimeoutSecs` is set. */
  timeoutMs?: number;
  /**
   * The key the start result and every event carry the backend job id under
   * (the Rust `AiArtifactMessages.id_field`). Set it and only this task's own
   * job is followed; another run's events are dropped, and another run taking
   * over the backend slot ends this one with `errorKind: 'superseded'`.
   */
  idField?: string;
  /**
   * The backend's own limit for this job (the Rust `AiArtifactMessages.timeout_secs`).
   * The frontend deadline is derived from it (`artifactDeadlineMs`), so the UI
   * never gives up on a run the backend still allows. At the deadline the job
   * is cancelled through `cancelFn`.
   */
  backendTimeoutSecs?: number;
  /** Custom getLine extractor. Defaults to `defaultGetLine` (payload.line). */
  getLine?: (payload: Record<string, unknown>) => string;
  /** Custom resolveStatus. Defaults to `buildResolveStatus(errorMessage)`. */
  resolveStatus?: (payload: Record<string, unknown>) => { result: TResult } | { error: string } | null;
  /**
   * Enable system-wide tracing for this task. When set, each start/complete/error
   * lifecycle emits UnifiedSpan entries into the system trace timeline.
   */
  traceOperation?: SystemOperationType;
}

export interface AiArtifactTaskState<TResult> {
  phase: string;
  lines: string[];
  result: TResult | null;
  error: string | null;
  /** Why the task ended in `error`: failed, start, timeout or superseded. */
  errorKind: TauriStreamErrorKind | null;
}

export interface AiArtifactTaskActions<TArgs extends unknown[], TResult> {
  start: (...args: TArgs) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  /** Lower-level setters for domain hooks that need custom phase transitions. */
  setPhase: TauriStreamActions<TResult>['setPhase'];
  setResult: TauriStreamActions<TResult>['setResult'];
  setError: TauriStreamActions<TResult>['setError'];
  setLines: TauriStreamActions<TResult>['setLines'];
  cleanup: TauriStreamActions<TResult>['cleanup'];
}

export type AiArtifactTaskReturn<TArgs extends unknown[], TResult> =
  AiArtifactTaskState<TResult> & AiArtifactTaskActions<TArgs, TResult>;

// -- Hook --------------------------------------------------------

/**
 * Unified hook for AI artifact task lifecycles.
 *
 * Encapsulates the full idle → running → streaming → result/error lifecycle
 * with built-in cancellation, timeout handling, and standard event parsing.
 *
 * Usage:
 * ```ts
 * const task = useAiArtifactTask<[string, string], MyResult>({
 *   progressEvent: 'my-task-progress',
 *   statusEvent: 'my-task-status',
 *   runningPhase: 'generating',
 *   completedPhase: 'reviewing',
 *   startFn: (id, desc) => startMyTask(id, desc),
 *   cancelFn: () => cancelMyTask(),
 *   errorMessage: 'Failed to run my task',
 * });
 *
 * // task.start(id, desc), task.cancel(), task.phase, task.lines, etc.
 * ```
 */
export function useAiArtifactTask<TArgs extends unknown[], TResult>(
  config: AiArtifactTaskConfig<TArgs, TResult>,
): AiArtifactTaskReturn<TArgs, TResult> {
  const {
    progressEvent,
    statusEvent,
    runningPhase,
    completedPhase,
    startFn,
    cancelFn,
    errorMessage = 'AI task failed',
    timeoutMs,
    idField,
    backendTimeoutSecs,
    getLine = defaultGetLine,
    resolveStatus: userResolveStatus,
    traceOperation,
  } = config;

  const traceSessionRef = useRef<SystemTraceSession | null>(null);

  // An unmount with a session still open used to leave it "active" in the
  // system-trace registry forever -- the operation is gone, but its row keeps
  // inflating the Observability panel's active count. Nothing failed here, so
  // the session is abandoned rather than completed with an error.
  useEffect(() => () => {
    traceSessionRef.current?.abandon();
    traceSessionRef.current = null;
  }, []);

  // Wrap resolveStatus to also complete the trace session on resolution
  const baseResolveStatus = userResolveStatus ?? buildResolveStatus<TResult>(errorMessage);
  const tracedResolveStatus = useCallback(
    (payload: Record<string, unknown>): { result: TResult } | { error: string } | null => {
      const outcome = baseResolveStatus(payload);
      if (outcome && traceSessionRef.current) {
        const session = traceSessionRef.current;
        if ('error' in outcome) {
          session.complete(outcome.error);
        } else {
          session.complete();
        }
        traceSessionRef.current = null;
      }
      return outcome;
    },
    [baseResolveStatus],
  );

  const stream = useTauriStream<TResult>({
    progressEvent,
    statusEvent,
    getLine,
    resolveStatus: traceOperation ? tracedResolveStatus : baseResolveStatus,
    completedPhase,
    runningPhase,
    startErrorMessage: errorMessage,
    timeoutMs: backendTimeoutSecs !== undefined ? artifactDeadlineMs(backendTimeoutSecs) : timeoutMs,
    idField,
    invokeCancelOnTimeout: cancelFn,
  });

  // A timeout or a takeover ends the task without a status event, so the
  // resolveStatus wrapper above never closes its trace session.
  const endedWithoutStatus = stream.errorKind === 'timeout' || stream.errorKind === 'superseded'
    ? stream.errorKind
    : null;
  useEffect(() => {
    if (!endedWithoutStatus || !traceSessionRef.current) return;
    traceSessionRef.current.complete(endedWithoutStatus);
    traceSessionRef.current = null;
  }, [endedWithoutStatus]);

  const start = useCallback(
    async (...args: TArgs) => {
      // Start a system trace session if tracing is enabled
      if (traceOperation) {
        traceSessionRef.current?.complete('cancelled');
        const label = `${errorMessage.replace(/ failed$/, '')}`;
        traceSessionRef.current = SystemTraceSession.start(traceOperation, label);
      }

      await stream.start(() => startFn(...args));
    },
    [traceOperation, stream, errorMessage, startFn],
  );

  const cancel = useCallback(() => {
    if (traceSessionRef.current) {
      traceSessionRef.current.complete('cancelled');
      traceSessionRef.current = null;
    }
    stream.cancel(cancelFn ? async () => { await cancelFn(); return; } : undefined);
  }, [stream, cancelFn]);

  return {
    phase: stream.phase,
    lines: stream.lines,
    result: stream.result,
    error: stream.error,
    errorKind: stream.errorKind,
    start,
    cancel,
    reset: stream.reset,
    setPhase: stream.setPhase,
    setResult: stream.setResult,
    setError: stream.setError,
    setLines: stream.setLines,
    cleanup: stream.cleanup,
  };
}
