import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  validatePayload,
  CliOutputSchema,
  ExecutionStatusSchema,
} from '@/lib/validation/eventPayloads';
import type { EventPayloadMap } from '@/lib/eventRegistry';
import {
  isTerminalState,
  parseExecutionState,
  type ExecutionState,
} from '@/lib/execution/executionState';

/**
 * Phase of a correlated CLI run.
 *
 * This is the canonical execution vocabulary (`ExecutionState` -- queued /
 * running / completed / failed / incomplete / cancelled / unknown) plus the
 * frontend-only `idle`, which means "this hook has never been started".
 *
 * It used to be `'idle' | 'running' | 'completed' | 'failed'`, and the status
 * listener accepted only those three backend values. Every other status the
 * backend can emit -- `cancelled`, `incomplete`, `queued`, and anything
 * unrecognised -- fell through the `if`, leaving the phase pinned at
 * `running`: a cancelled run spun forever in the n8n transform/test wizards,
 * the query debugger, the background template preview and every
 * `CliOutputPanel`. Unknown is not a value; it is a state, and it is now one
 * of ours.
 */
export type CliRunPhase = 'idle' | ExecutionState;

/**
 * Map a raw backend status string onto a `CliRunPhase`.
 *
 * Delegates to the canonical `parseExecutionState` (which also resolves the
 * legacy `pending` -> `queued` alias) and treats an absent/blank status as
 * `unknown` rather than `parseExecutionState`'s `queued` default -- a status
 * event that carries no status is corruption, not a queue position.
 */
export function toCliRunPhase(status: string | null | undefined): CliRunPhase {
  if (typeof status !== 'string' || status.trim().length === 0) return 'unknown';
  return parseExecutionState(status.trim());
}

/**
 * True while the run may still produce output: `queued` or `running`.
 * `queued` is deliberately a distinct phase rather than an alias of
 * `running` -- the run is waiting for a slot, so surfaces show a calm
 * "Queued" label instead of a spinner over a fake progress bar.
 */
export function isCliRunActive(phase: CliRunPhase): boolean {
  return phase === 'queued' || phase === 'running';
}

/** True once the run has stopped for any reason (including `unknown`). */
export function isCliRunSettled(phase: CliRunPhase): boolean {
  return phase !== 'idle' && isTerminalState(phase);
}

/**
 * True when the run stopped without succeeding -- `failed`, `incomplete`,
 * `cancelled` or `unknown`. Surfaces use it to stop a spinner and offer a
 * retry; it is NOT the same as "errored", so callers that need the red error
 * treatment keep checking `phase === 'failed'`.
 */
export function isCliRunUnsuccessful(phase: CliRunPhase): boolean {
  return isCliRunSettled(phase) && phase !== 'completed';
}

/** Maximum lines kept in the stream buffer to prevent OOM on long executions. */
const MAX_STREAM_LINES = 5000;
/** Maximum length of a single stream line in characters. */
const MAX_STREAM_LINE_LENGTH = 4096;

interface UseCorrelatedCliStreamOptions {
  outputEvent: keyof EventPayloadMap | string;
  statusEvent: keyof EventPayloadMap | string;
  idField: string;
  onFailed?: (errorMessage: string) => void;
  /** Called for every correlated output line (after dedup). */
  onOutputLine?: (line: string) => void;
  /** Called for every correlated status event with the raw payload. */
  onStatusEvent?: (payload: Record<string, unknown>) => void;
  /**
   * Whether to accumulate lines in the hook's own state buffer. Default `true`.
   * Set to `false` when the consumer pipes lines to an external buffer (e.g. the
   * execution store) to avoid maintaining a duplicate 5000-line buffer.
   */
  bufferLines?: boolean;
}

export function useCorrelatedCliStream({
  outputEvent,
  statusEvent,
  idField,
  onFailed,
  onOutputLine,
  onStatusEvent,
  bufferLines = true,
}: UseCorrelatedCliStreamOptions) {
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState<CliRunPhase>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  // Capture bufferLines in a ref so the listener closure always sees the latest
  // value without recreating the `start` callback.
  const bufferLinesRef = useRef(bufferLines);
  bufferLinesRef.current = bufferLines;

  // Use refs for callbacks so that the `start` callback has a stable identity.
  // Without this, any inline arrow function causes `start` to be recreated
  // every render, which can trigger infinite update loops in effects that
  // depend on `start`.
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onOutputLineRef = useRef(onOutputLine);
  onOutputLineRef.current = onOutputLine;
  const onStatusEventRef = useRef(onStatusEvent);
  onStatusEventRef.current = onStatusEvent;

  const cleanup = useCallback(async () => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const start = useCallback(
    async (nextRunId: string) => {
      await cleanup();
      setRunId(nextRunId);
      setLines([]);
      setPhase('running');

      const unlistenOutput = await listen<Record<string, unknown>>(outputEvent, (event) => {
        const raw = event.payload ?? {};
        if (String(raw[idField] ?? '') !== nextRunId) return;

        const validated = validatePayload(outputEvent, raw, CliOutputSchema);
        if (!validated) return;

        const rawLine = validated.line;
        if (rawLine.trim().length > 0) {
          const line = rawLine.length > MAX_STREAM_LINE_LENGTH
            ? rawLine.slice(0, MAX_STREAM_LINE_LENGTH) + '...[truncated]'
            : rawLine;
          if (bufferLinesRef.current) {
            setLines((prev) => {
              if (prev[prev.length - 1] === line) {
                return prev;
              }
              if (prev.length >= MAX_STREAM_LINES) {
                const trimmed = prev.slice(prev.length - MAX_STREAM_LINES + 1);
                trimmed.push(line);
                return trimmed;
              }
              return [...prev, line];
            });
          }
          onOutputLineRef.current?.(line);
        }
      });

      const unlistenStatus = await listen<Record<string, unknown>>(statusEvent, (event) => {
        const raw = event.payload ?? {};
        if (String(raw[idField] ?? '') !== nextRunId) return;

        const validated = validatePayload(statusEvent, raw, ExecutionStatusSchema);
        if (!validated) return;

        const nextPhase = toCliRunPhase(validated.status);
        setPhase(nextPhase);

        // `onFailed` stays scoped to a real failure: it is the door consumers
        // use to show an error message and pre-fill a "fix this" request, and
        // a user-initiated cancel is not an error. Consumers tell the other
        // terminal states apart from `phase` via `isCliRunUnsuccessful`.
        if (nextPhase === 'failed' && onFailedRef.current) {
          onFailedRef.current(validated.error ?? 'CLI transformation failed.');
        }

        // Pass the validated payload to the consumer as the original Record shape
        // for backward compatibility with handleStatusEvent in usePersonaExecution
        onStatusEventRef.current?.(raw);
      });

      unlistenersRef.current = [unlistenOutput, unlistenStatus];
    },
    [cleanup, idField, outputEvent, statusEvent],
  );

  const reset = useCallback(async () => {
    await cleanup();
    setRunId(null);
    setLines([]);
    setPhase('idle');
  }, [cleanup]);

  useEffect(() => {
    return () => {
      for (const unlisten of unlistenersRef.current) {
        unlisten();
      }
      unlistenersRef.current = [];
    };
  }, []);

  return {
    runId,
    phase,
    lines,
    setLines,
    setPhase,
    start,
    cleanup,
    reset,
  };
}
