import { useState, useCallback, useRef, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { silentCatch } from "@/lib/silentCatch";

/** Cap the streamed-line buffer. This hook backs many CLI-driven design flows
 *  (reviews, credential/schema/n8n/AI-artifact generation); a long run streams
 *  thousands of lines and the panel only shows a scrolling tail, so retain the
 *  most recent N to keep the JS heap flat. Matches the backend ring cap. */
const MAX_STREAM_LINES = 500;

// -- Types -------------------------------------------------------

/**
 * The `resolveStatus` outcome shape. When `TQuestion` is the default
 * `never` (a consumer that never needs a "question" outcome), this collapses
 * to exactly the original two-way `{ result } | { error } | null` shape --
 * byte-for-byte, not just structurally compatible -- so every existing
 * caller's own return-type annotations (e.g. `useAiArtifactTask`'s
 * `tracedResolveStatus`, `buildResolveStatus`) keep type-checking unchanged.
 *
 * The `[T] extends [never]` wrapping (rather than a bare
 * `TQuestion extends never`) sidesteps TypeScript's conditional-type
 * distribution-over-`never` behavior, which would otherwise collapse the
 * whole type to `never` instead of picking a branch.
 */
export type TauriStreamOutcome<TResult, TQuestion = never> = [TQuestion] extends [never]
  ? { result: TResult } | { error: string } | null
  : { result: TResult } | { question: TQuestion } | { error: string } | null;

export interface TauriStreamOptions<TResult, TQuestion = never> {
  /** Tauri event name for progress/output lines. */
  progressEvent: string;
  /** Tauri event name for status transitions. */
  statusEvent: string;
  /** Extract the text line from a progress payload. */
  getLine: (payload: Record<string, unknown>) => string;
  /**
   * Handle a status payload. Return a result to transition to
   * `completedPhase`; a question (non-terminal -- the generator is asking
   * something rather than failing or finishing; call `start()` again to
   * continue) to transition to `awaitingInputPhase`; an error; or null to
   * ignore the payload. Mirrors the backend's `PipelineOutcome<T> =
   * Result(T) | Question(Value) | Failed` three-way shape so a consumer that
   * can be asked a question doesn't need to smuggle it through the result
   * channel.
   */
  resolveStatus: (payload: Record<string, unknown>) => TauriStreamOutcome<TResult, TQuestion>;
  /** Phase to transition to when resolveStatus returns a result. */
  completedPhase: string;
  /** Phase while the stream is running (set on start). */
  runningPhase: string;
  /**
   * Phase to transition to when resolveStatus returns a question. Only
   * relevant for consumers whose `resolveStatus` can return `{ question }`.
   * Default: 'awaiting-input'.
   */
  awaitingInputPhase?: string;
  /** Default error message when start() throws. */
  startErrorMessage?: string;
  /** Timeout in ms for the running phase. Auto-resets to idle if no completion arrives. Default: 5 minutes. */
  timeoutMs?: number;
}

export interface TauriStreamState<TResult, TQuestion = never> {
  phase: string;
  lines: string[];
  result: TResult | null;
  /** The most recent clarification question, if the generator asked one. */
  question: TQuestion | null;
  error: string | null;
}

export interface TauriStreamActions<TResult, TQuestion = never> {
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
  /** Direct question setter for domain-specific handling. */
  setQuestion: (question: TQuestion | null) => void;
  /** Direct lines setter/clearer. */
  setLines: (lines: string[]) => void;
}

export function useTauriStream<TResult, TQuestion = never>(
  options: TauriStreamOptions<TResult, TQuestion>,
): TauriStreamState<TResult, TQuestion> & TauriStreamActions<TResult, TQuestion> {
  const {
    progressEvent,
    statusEvent,
    getLine,
    resolveStatus,
    completedPhase,
    runningPhase,
    awaitingInputPhase = 'awaiting-input',
    startErrorMessage = 'Stream failed to start',
    timeoutMs = 5 * 60 * 1000, // 5 minutes default
  } = options;

  const [phase, setPhase] = useState('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<TResult | null>(null);
  const [question, setQuestion] = useState<TQuestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monotonic generation counter — incremented on every start/cancel/reset to
   *  invalidate in-flight async work from a previous generation. */
  const generationRef = useRef(0);

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
    const gen = ++generationRef.current;
    setPhase(runningPhase);
    setLines([]);
    setResult(null);
    setQuestion(null);
    setError(null);

    try {
      // Register both listeners before starting the backend command to avoid
      // a race where fast completions emit events before listeners are ready.
      const [unlistenProgress, unlistenStatus] = await Promise.all([
        listen(progressEvent, (event) => {
          if (generationRef.current !== gen) return;
          const line = getLine(event.payload as Record<string, unknown>);
          setLines((prev) =>
            prev.length >= MAX_STREAM_LINES
              ? [...prev.slice(prev.length - MAX_STREAM_LINES + 1), line]
              : [...prev, line],
          );
        }),
        listen(statusEvent, (event) => {
          if (generationRef.current !== gen) return;
          const outcome = resolveStatus(event.payload as Record<string, unknown>);
          if (!outcome) return;

          if ('result' in outcome) {
            setResult(outcome.result);
            setPhase(completedPhase);
          } else if ('question' in outcome) {
            setQuestion(outcome.question);
            setPhase(awaitingInputPhase);
          } else {
            setError(outcome.error);
            setPhase('error');
          }
          cleanup();
        }),
      ]);

      // If cancel/reset/another start happened during the await, tear down
      // the just-registered listeners immediately — they belong to a stale generation.
      if (generationRef.current !== gen) {
        unlistenProgress();
        unlistenStatus();
        return;
      }

      unlistenersRef.current = [unlistenProgress, unlistenStatus];

      // Start timeout — auto-reset to error if no completion arrives.
      // The generation guard prevents this from firing after a cancel/reset.
      clearTimeout_();
      timeoutRef.current = setTimeout(() => {
        if (generationRef.current !== gen) return;
        cleanup();
        setError('Operation timed out. Please try again.');
        setPhase('error');
      }, timeoutMs);

      await invokeBackend();
    } catch (err) {
      if (generationRef.current !== gen) return;
      setError(err instanceof Error ? err.message : startErrorMessage);
      setPhase('error');
      cleanup();
    }
  }, [cleanup, clearTimeout_, progressEvent, statusEvent, getLine, resolveStatus, completedPhase, runningPhase, awaitingInputPhase, startErrorMessage, timeoutMs]);

  const cancel = useCallback((invokeCancel?: () => Promise<void>) => {
    ++generationRef.current;
    invokeCancel?.().catch(silentCatch("tauriStream:cancel"));
    cleanup();
    setPhase('idle');
    setLines([]);
    setQuestion(null);
    setError(null);
  }, [cleanup]);

  const reset = useCallback(() => {
    ++generationRef.current;
    cleanup();
    setPhase('idle');
    setLines([]);
    setResult(null);
    setQuestion(null);
    setError(null);
  }, [cleanup]);

  return {
    phase,
    lines,
    result,
    question,
    error,
    start,
    cancel,
    reset,
    cleanup,
    setPhase,
    setError,
    setResult,
    setQuestion,
    setLines,
  };
}
