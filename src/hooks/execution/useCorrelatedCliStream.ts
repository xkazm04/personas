import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type CliRunPhase = 'idle' | 'running' | 'completed' | 'failed';

interface UseCorrelatedCliStreamOptions {
  outputEvent: string;
  statusEvent: string;
  idField: string;
  onFailed?: (errorMessage: string) => void;
  /** Called for every correlated output line (after dedup). */
  onOutputLine?: (line: string) => void;
  /** Called for every correlated status event with the raw payload. */
  onStatusEvent?: (payload: Record<string, unknown>) => void;
}

export function useCorrelatedCliStream({
  outputEvent,
  statusEvent,
  idField,
  onFailed,
  onOutputLine,
  onStatusEvent,
}: UseCorrelatedCliStreamOptions) {
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState<CliRunPhase>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

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
        const payload = event.payload ?? {};
        if (String(payload[idField] ?? '') !== nextRunId) return;

        const line = payload['line'];
        if (typeof line === 'string' && line.trim().length > 0) {
          setLines((prev) => {
            if (prev[prev.length - 1] === line) {
              return prev;
            }
            return [...prev, line];
          });
          onOutputLineRef.current?.(line);
        }
      });

      const unlistenStatus = await listen<Record<string, unknown>>(statusEvent, (event) => {
        const payload = event.payload ?? {};
        if (String(payload[idField] ?? '') !== nextRunId) return;

        const nextStatus = payload['status'];
        if (nextStatus === 'running' || nextStatus === 'completed' || nextStatus === 'failed') {
          setPhase(nextStatus);
        }

        if (nextStatus === 'failed' && onFailedRef.current) {
          const err = payload['error'];
          onFailedRef.current(typeof err === 'string' ? err : 'CLI transformation failed.');
        }

        onStatusEventRef.current?.(payload);
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
