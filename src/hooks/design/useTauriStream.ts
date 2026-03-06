import { useState, useCallback, useRef, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ── Types ───────────────────────────────────────────────────────

export interface TauriStreamOptions<TResult> {
  /** Tauri event name for progress/output lines. */
  progressEvent: string;
  /** Tauri event name for status transitions. */
  statusEvent: string;
  /** Extract the text line from a progress payload. */
  getLine: (payload: Record<string, unknown>) => string;
  /** Handle a status payload — return a result to transition to `completedPhase`, or null to ignore. */
  resolveStatus: (payload: Record<string, unknown>) => { result: TResult } | { error: string } | null;
  /** Phase to transition to when resolveStatus returns a result. */
  completedPhase: string;
  /** Phase while the stream is running (set on start). */
  runningPhase: string;
  /** Default error message when start() throws. */
  startErrorMessage?: string;
  /** Timeout in ms for the running phase. Auto-resets to idle if no completion arrives. Default: 5 minutes. */
  timeoutMs?: number;
}

export interface TauriStreamState<TResult> {
  phase: string;
  lines: string[];
  result: TResult | null;
  error: string | null;
}

export interface TauriStreamActions<TResult> {
  /** Start listening then invoke the backend command via the provided callback. */
  start: (invokeBackend: () => Promise<unknown>) => Promise<void>;
  /** Cancel via the provided callback, cleanup listeners, reset to idle. */
  cancel: (invokeCancel?: () => Promise<void>) => void;
  /** Full reset to idle state. */
  reset: () => void;
  /** Cleanup listeners only (useful when overriding phase externally). */
  cleanup: () => void;
  /** Direct phase setter for domain-specific transitions. */
  setPhase: (phase: string) => void;
  /** Direct error setter for domain-specific error handling. */
  setError: (error: string | null) => void;
  /** Direct result setter for loading pre-built results (e.g. templates). */
  setResult: (result: TResult | null) => void;
  /** Direct lines setter/clearer. */
  setLines: (lines: string[]) => void;
}

export function useTauriStream<TResult>(
  options: TauriStreamOptions<TResult>,
): TauriStreamState<TResult> & TauriStreamActions<TResult> {
  const {
    progressEvent,
    statusEvent,
    getLine,
    resolveStatus,
    completedPhase,
    runningPhase,
    startErrorMessage = 'Stream failed to start',
    timeoutMs = 5 * 60 * 1000, // 5 minutes default
  } = options;

  const [phase, setPhase] = useState('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeout_ = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimeout_();
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, [clearTimeout_]);

  // Clean up Tauri event listeners and timeout on unmount.
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (invokeBackend: () => Promise<unknown>) => {
    cleanup();
    setPhase(runningPhase);
    setLines([]);
    setResult(null);
    setError(null);

    try {
      // Register both listeners before starting the backend command to avoid
      // a race where fast completions emit events before listeners are ready.
      const [unlistenProgress, unlistenStatus] = await Promise.all([
        listen(progressEvent, (event) => {
          const line = getLine(event.payload as Record<string, unknown>);
          setLines((prev) => [...prev, line]);
        }),
        listen(statusEvent, (event) => {
          const outcome = resolveStatus(event.payload as Record<string, unknown>);
          if (!outcome) return;

          if ('result' in outcome) {
            setResult(outcome.result);
            setPhase(completedPhase);
          } else {
            setError(outcome.error);
            setPhase('error');
          }
          cleanup();
        }),
      ]);

      unlistenersRef.current = [unlistenProgress, unlistenStatus];

      // Start negotiation timeout — auto-reset to idle if no completion arrives.
      clearTimeout_();
      timeoutRef.current = setTimeout(() => {
        cleanup();
        setError('Operation timed out. Please try again.');
        setPhase('error');
      }, timeoutMs);

      await invokeBackend();
    } catch (err) {
      setError(err instanceof Error ? err.message : startErrorMessage);
      setPhase('error');
      cleanup();
    }
  }, [cleanup, clearTimeout_, progressEvent, statusEvent, getLine, resolveStatus, completedPhase, runningPhase, startErrorMessage, timeoutMs]);

  const cancel = useCallback((invokeCancel?: () => Promise<void>) => {
    invokeCancel?.().catch(() => {});
    cleanup();
    setPhase('idle');
    setLines([]);
    setError(null);
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setLines([]);
    setResult(null);
    setError(null);
  }, [cleanup]);

  return {
    phase,
    lines,
    result,
    error,
    start,
    cancel,
    reset,
    cleanup,
    setPhase,
    setError,
    setResult,
    setLines,
  };
}
