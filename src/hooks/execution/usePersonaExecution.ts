import { useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useCorrelatedCliStream } from './useCorrelatedCliStream';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'incomplete'];

export function usePersonaExecution() {
  const clearOutput = usePersonaStore((s) => s.clearExecutionOutput);
  const activeExecutionId = usePersonaStore((s) => s.activeExecutionId);
  const prevExecIdRef = useRef<string | null>(null);

  const handleOutputLine = useCallback((line: string) => {
    usePersonaStore.getState().appendExecutionOutput(line);
  }, []);

  const handleStatusEvent = useCallback((payload: Record<string, unknown>) => {
    const status = payload['status'];
    if (typeof status !== 'string' || !TERMINAL_STATUSES.includes(status)) return;

    const store = usePersonaStore.getState();
    const error = payload['error'];
    if (typeof error === 'string' && error) {
      store.appendExecutionOutput(`[ERROR] ${error}`);
    }
    const summary = JSON.stringify({
      status,
      duration_ms: payload['duration_ms'] ?? null,
      cost_usd: payload['cost_usd'] ?? null,
    });
    store.appendExecutionOutput(`[SUMMARY]${summary}`);
    store.finishExecution(status);
  }, []);

  const { start, cleanup } = useCorrelatedCliStream({
    outputEvent: 'execution-output',
    statusEvent: 'execution-status',
    idField: 'execution_id',
    onOutputLine: handleOutputLine,
    onStatusEvent: handleStatusEvent,
  });

  // Start listening whenever a new execution begins
  useEffect(() => {
    if (activeExecutionId && activeExecutionId !== prevExecIdRef.current) {
      prevExecIdRef.current = activeExecutionId;
      void start(activeExecutionId);
    }
  }, [activeExecutionId, start]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const disconnect = useCallback(() => {
    void cleanup();
  }, [cleanup]);

  return { disconnect, clearOutput };
}
