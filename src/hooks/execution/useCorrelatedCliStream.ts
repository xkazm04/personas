import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type CliRunPhase = 'idle' | 'running' | 'completed' | 'failed';

interface UseCorrelatedCliStreamOptions {
  outputEvent: string;
  statusEvent: string;
  idField?: string;
  lineField?: string;
  statusField?: string;
  errorField?: string;
  onFailed?: (errorMessage: string) => void;
}

export function useCorrelatedCliStream({
  outputEvent,
  statusEvent,
  idField = 'transform_id',
  lineField = 'line',
  statusField = 'status',
  errorField = 'error',
  onFailed,
}: UseCorrelatedCliStreamOptions) {
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState<CliRunPhase>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

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

        const line = payload[lineField];
        if (typeof line === 'string' && line.trim().length > 0) {
          setLines((prev) => {
            if (prev[prev.length - 1] === line) {
              return prev;
            }
            return [...prev, line];
          });
        }
      });

      const unlistenStatus = await listen<Record<string, unknown>>(statusEvent, (event) => {
        const payload = event.payload ?? {};
        if (String(payload[idField] ?? '') !== nextRunId) return;

        const nextStatus = payload[statusField];
        if (nextStatus === 'running' || nextStatus === 'completed' || nextStatus === 'failed') {
          setPhase(nextStatus);
        }

        if (nextStatus === 'failed' && onFailed) {
          const err = payload[errorField];
          onFailed(typeof err === 'string' ? err : 'CLI transformation failed.');
        }
      });

      unlistenersRef.current = [unlistenOutput, unlistenStatus];
    },
    [cleanup, errorField, idField, lineField, onFailed, outputEvent, statusEvent, statusField],
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
