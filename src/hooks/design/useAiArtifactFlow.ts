import { useCallback } from 'react';
import { useTauriStream, type TauriStreamOptions } from './useTauriStream';

// ── Types ───────────────────────────────────────────────────────

/**
 * Configuration for an AI-generates-structured-artifact flow.
 *
 * Captures the invariant parts of the pattern:
 *   - which Tauri events to listen on
 *   - how to extract a progress line from a payload
 *   - how to resolve a status payload into a result or error
 *   - what phase names to use during / after completion
 *
 * @template TPromptInput - the arguments passed to `start()` to kick off the AI task
 * @template TResult      - the structured artifact the AI produces
 */
export interface AiArtifactFlowConfig<TPromptInput, TResult> {
  /** Options forwarded verbatim to useTauriStream. */
  stream: TauriStreamOptions<TResult>;
  /**
   * Given the user-facing prompt input, return a promise that invokes the
   * Tauri backend and starts streaming (e.g. calls `invoke("start_…")`).
   */
  startFn: (input: TPromptInput) => Promise<unknown>;
}

/**
 * Hook that represents a complete AI-generates-artifact lifecycle:
 *
 *   idle → (start) → runningPhase → (status event) → completedPhase | error
 *
 * Use this to build domain-specific hooks without reimplementing the streaming
 * plumbing.  Extend the returned value with domain-specific state (see
 * `useCredentialDesign` and `useCredentialNegotiator` for examples).
 *
 * @template TPromptInput - shape of the arguments your `startFn` expects
 * @template TResult      - shape of the AI-generated artifact
 */
export function useAiArtifactFlow<TPromptInput, TResult>(
  config: AiArtifactFlowConfig<TPromptInput, TResult>,
) {
  const { stream: streamOptions, startFn } = config;

  const stream = useTauriStream<TResult>(streamOptions);

  /** Start the AI task with the given prompt input. */
  const start = useCallback(
    async (input: TPromptInput) => {
      await stream.start(() => startFn(input));
    },
    [stream.start, startFn],
  );

  return {
    ...stream,
    /** Typed start — replaces the raw `stream.start(invokeBackend)` call. */
    start,
  };
}

// ── Standard getLine / resolveStatus helpers ─────────────────────────────────

/**
 * Default getLine extractor — pulls `payload.line` as a string.
 * Works for both credential-design and negotiator events.
 */
export const defaultGetLine = (payload: Record<string, unknown>): string =>
  payload.line as string;

/**
 * Build a standard resolveStatus function for the common n8n-transform /
 * credential-design / negotiator pattern:
 *
 *   payload.status === 'completed' && payload.result → { result }
 *   payload.status === 'failed'                      → { error }
 *   otherwise                                         → null (ignore)
 */
export function buildResolveStatus<TResult>(
  fallbackError: string,
): TauriStreamOptions<TResult>['resolveStatus'] {
  return (payload: Record<string, unknown>) => {
    const status = payload.status as string;
    if (status === 'completed' && payload.result) {
      return { result: payload.result as TResult };
    }
    if (status === 'failed') {
      return { error: (payload.error as string) || fallbackError };
    }
    return null;
  };
}
