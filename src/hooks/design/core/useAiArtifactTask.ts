import { useCallback } from 'react';
import { useTauriStream, type TauriStreamActions } from './useTauriStream';
import { defaultGetLine, buildResolveStatus } from '../template/useAiArtifactFlow';

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
  /** Timeout in ms. Default: 5 minutes. */
  timeoutMs?: number;
  /** Custom getLine extractor. Defaults to `defaultGetLine` (payload.line). */
  getLine?: (payload: Record<string, unknown>) => string;
  /** Custom resolveStatus. Defaults to `buildResolveStatus(errorMessage)`. */
  resolveStatus?: (payload: Record<string, unknown>) => { result: TResult } | { error: string } | null;
}

export interface AiArtifactTaskState<TResult> {
  phase: string;
  lines: string[];
  result: TResult | null;
  error: string | null;
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
    getLine = defaultGetLine,
    resolveStatus = buildResolveStatus<TResult>(errorMessage),
  } = config;

  const stream = useTauriStream<TResult>({
    progressEvent,
    statusEvent,
    getLine,
    resolveStatus,
    completedPhase,
    runningPhase,
    startErrorMessage: errorMessage,
    timeoutMs,
  });

  const start = useCallback(
    async (...args: TArgs) => {
      await stream.start(() => startFn(...args));
    },
    [stream.start, startFn],
  );

  const cancel = useCallback(() => {
    stream.cancel(cancelFn ? async () => { await cancelFn(); return; } : undefined);
  }, [stream.cancel, cancelFn]);

  return {
    phase: stream.phase,
    lines: stream.lines,
    result: stream.result,
    error: stream.error,
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
