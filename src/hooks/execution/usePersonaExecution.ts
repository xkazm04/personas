import { useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';
import { useCorrelatedCliStream } from './useCorrelatedCliStream';
import { traceStage } from '@/lib/execution/pipeline';
import { isTerminalState } from '@/lib/execution/executionState';
import type { QueueStatusPayload } from '@/stores/slices/executionSlice';

export function usePersonaExecution() {
  const clearOutput = usePersonaStore((s) => s.clearExecutionOutput);
  const activeExecutionId = usePersonaStore((s) => s.activeExecutionId);
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const prevExecIdRef = useRef<string | null>(null);
  const prevPersonaIdRef = useRef<string | null>(null);
  const streamTracedRef = useRef(false);
  const queueUnlistenRef = useRef<UnlistenFn | null>(null);

  /** Guard: returns true when the executing persona still matches the selected persona. */
  const isOwnerAligned = (): boolean => {
    const s = usePersonaStore.getState();
    // If there's no execution persona or no selection, allow (startup / teardown edge cases)
    if (!s.executionPersonaId || !s.selectedPersonaId) return true;
    return s.executionPersonaId === s.selectedPersonaId;
  };

  const handleOutputLine = useCallback((line: string) => {
    if (!isOwnerAligned()) return;
    const store = usePersonaStore.getState();
    // Pipeline: trace stream_output on first output line
    if (!streamTracedRef.current && store.pipelineTrace) {
      streamTracedRef.current = true;
      store.pipelineTrace = traceStage(store.pipelineTrace, 'stream_output');
    }
    store.appendExecutionOutput(line);
  }, []);

  const handleStatusEvent = useCallback((payload: Record<string, unknown>) => {
    if (!isOwnerAligned()) return;

    const status = payload['status'];

    // When promoted from queue to running, clear queue position
    if (status === 'running') {
      usePersonaStore.getState().setQueueStatus(null, null);
    }

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
    // The execution store (executionSlice) is the single source of truth for
    // terminal output. Disable the hook's own 5000-line buffer to prevent
    // duplicate memory usage and divergent trim points.
    bufferLines: false,
  });

  // Listen for queue-status events (queued / promoted)
  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      // Clean up previous listener
      if (queueUnlistenRef.current) {
        queueUnlistenRef.current();
        queueUnlistenRef.current = null;
      }

      const unlisten = await listen<QueueStatusPayload>('queue-status', (event) => {
        if (cancelled) return;
        const payload = event.payload;
        const store = usePersonaStore.getState();
        if (store.activeExecutionId !== payload.execution_id) return;

        if (payload.action === 'queued') {
          store.setQueueStatus(payload.position, payload.queue_depth);
          store.appendExecutionOutput(`[QUEUE] Position ${(payload.position ?? 0) + 1} of ${payload.queue_depth} in queue`);
        } else if (payload.action === 'promoted') {
          store.setQueueStatus(null, null);
          store.appendExecutionOutput('[QUEUE] Promoted to running slot');
        }
      });

      if (!cancelled) {
        queueUnlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    };
    void setup();

    return () => {
      cancelled = true;
      if (queueUnlistenRef.current) {
        queueUnlistenRef.current();
        queueUnlistenRef.current = null;
      }
    };
  }, []);

  // Disconnect listeners when persona changes to prevent cross-contamination.
  // The execution keeps running in the backend; we just stop piping its output
  // into the terminal that now belongs to a different persona.
  useEffect(() => {
    if (selectedPersonaId !== prevPersonaIdRef.current) {
      if (prevPersonaIdRef.current !== null) {
        const store = usePersonaStore.getState();
        if (store.executionPersonaId && store.executionPersonaId !== selectedPersonaId) {
          void cleanup();
        }
      }
      prevPersonaIdRef.current = selectedPersonaId;
    }
  }, [selectedPersonaId, cleanup]);

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
