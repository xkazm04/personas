import { useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useCorrelatedCliStream } from './useCorrelatedCliStream';
import { traceStage } from '@/lib/execution/pipeline';
import { isTerminalState } from '@/lib/execution/executionState';

export function usePersonaExecution() {
  const clearOutput = usePersonaStore((s) => s.clearExecutionOutput);
  const activeExecutionId = usePersonaStore((s) => s.activeExecutionId);
  const prevExecIdRef = useRef<string | null>(null);
  const streamTracedRef = useRef(false);

  const handleOutputLine = useCallback((line: string) => {
    const store = usePersonaStore.getState();
    // Pipeline: trace stream_output on first output line
    if (!streamTracedRef.current && store.pipelineTrace) {
      streamTracedRef.current = true;
      store.pipelineTrace = traceStage(store.pipelineTrace, 'stream_output');
    }
    store.appendExecutionOutput(line);
  }, []);

  const handleStatusEvent = useCallback((payload: Record<string, unknown>) => {
    const status = payload['status'];
    if (typeof status !== 'string' || !isTerminalState(status)) return;

    const store = usePersonaStore.getState();
    // Pipeline: trace finalize_status
    if (store.pipelineTrace) {
      store.pipelineTrace = traceStage(store.pipelineTrace, 'finalize_status', {
        status,
        durationMs: payload['duration_ms'] ?? null,
        costUsd: payload['cost_usd'] ?? null,
      });
    }
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
      streamTracedRef.current = false;
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
