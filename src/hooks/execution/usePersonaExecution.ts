import { useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAgentStore } from "@/stores/agentStore";
import { useCorrelatedCliStream } from './useCorrelatedCliStream';
import { EventName } from '@/lib/eventRegistry';
import { traceStage, runMiddleware, type FinalizeStatusPayload } from '@/lib/execution/pipeline';
import { isTerminalState } from '@/lib/execution/executionState';
import { validatePayload, ExecutionStatusSchema } from '@/lib/validation/eventPayloads';
import type { QueueStatusPayload } from '@/stores/slices/agents/executionSlice';
import { getExecutionLogLines } from '@/api/agents/executions';

export function usePersonaExecution() {
  const clearOutput = useAgentStore((s) => s.clearExecutionOutput);
  const activeExecutionId = useAgentStore((s) => s.activeExecutionId);
  const selectedPersonaId = useAgentStore((s) => s.selectedPersonaId);
  const prevExecIdRef = useRef<string | null>(null);
  const prevPersonaIdRef = useRef<string | null>(null);
  const streamTracedRef = useRef(false);
  const queueUnlistenRef = useRef<UnlistenFn | null>(null);

  /** Guard: returns true when the executing persona still matches the selected persona. */
  const isOwnerAligned = (): boolean => {
    const s = useAgentStore.getState();
    // If there's no execution persona or no selection, allow (startup / teardown edge cases)
    if (!s.executionPersonaId || !s.selectedPersonaId) return true;
    return s.executionPersonaId === s.selectedPersonaId;
  };

  const handleOutputLine = useCallback((line: string) => {
    if (!isOwnerAligned()) return;
    const store = useAgentStore.getState();
    // Pipeline: trace stream_output on first output line
    if (!streamTracedRef.current && store.pipelineTrace) {
      streamTracedRef.current = true;
      useAgentStore.setState((state) => ({
        pipelineTrace: state.pipelineTrace
          ? traceStage(state.pipelineTrace, 'stream_output')
          : null,
      }));
    }
    store.appendExecutionOutput(line);
  }, []);

  const handleStatusEvent = useCallback((raw: Record<string, unknown>) => {
    if (!isOwnerAligned()) return;

    const validated = validatePayload('execution-status', raw, ExecutionStatusSchema);
    if (!validated) return;

    const { status, error, duration_ms, cost_usd } = validated;

    // When promoted from queue to running, clear queue position
    if (status === 'running') {
      useAgentStore.getState().setQueueStatus(null, null);
    }

    if (!isTerminalState(status)) return;

    const store = useAgentStore.getState();
    // Pipeline: trace finalize_status
    if (store.pipelineTrace) {
      useAgentStore.setState((state) => ({
        pipelineTrace: state.pipelineTrace
          ? traceStage(state.pipelineTrace, 'finalize_status', {
            status,
            durationMs: duration_ms ?? null,
            costUsd: cost_usd ?? null,
          })
          : null,
      }));

      // Run finalize_status middleware (fire-and-forget -- non-blocking)
      const trace = useAgentStore.getState().pipelineTrace;
      if (trace) {
        const finalizePayload: FinalizeStatusPayload = {
          executionId: store.activeExecutionId ?? '',
          status: status as FinalizeStatusPayload['status'],
          error: error ?? null,
          durationMs: duration_ms ?? null,
          costUsd: cost_usd ?? null,
        };
        void runMiddleware('finalize_status', finalizePayload, trace).catch((err) => { console.warn('[execution] finalize_status middleware failed:', err); });
      }
    }
    if (error) {
      store.appendExecutionOutput(`[ERROR] ${error}`);
    }
    store.finishExecution(status, {
      durationMs: duration_ms ?? null,
      costUsd: cost_usd ?? null,
      errorMessage: error ?? null,
    });
  }, []);

  const { start, cleanup } = useCorrelatedCliStream({
    outputEvent: EventName.EXECUTION_OUTPUT,
    statusEvent: EventName.EXECUTION_STATUS,
    idField: 'execution_id',
    onOutputLine: handleOutputLine,
    onStatusEvent: handleStatusEvent,
    // The execution store (executionSlice) is the single source of truth for
    // terminal output. Disable the hook's own 5000-line buffer to prevent
    // duplicate memory usage and divergent trim points.
    bufferLines: false,
  });

  // Recovery: replay missed output lines after page reload
  const recoveryAttemptedRef = useRef(false);
  useEffect(() => {
    if (recoveryAttemptedRef.current) return;
    const store = useAgentStore.getState();
    const execId = store.activeExecutionId;
    const personaId = store.executionPersonaId;
    if (!execId || !store.isExecuting || !personaId) return;

    recoveryAttemptedRef.current = true;

    // Replay log lines that were missed during reload
    getExecutionLogLines(execId, personaId)
      .then((lines) => {
        const sink = useAgentStore.getState().appendExecutionOutput;
        for (const line of lines) {
          sink(line);
        }
      })
      .catch(() => {
        // Recovery failed -- execution may have completed during reload
        // Check if still running by trying to get status
      });
  }, []);

  // Listen for queue-status events only while an execution is active.
  // This avoids registering idle listeners on the Tauri IPC bridge when
  // users are browsing agents without running them.
  useEffect(() => {
    if (!activeExecutionId) {
      // No execution -- tear down any lingering listener
      if (queueUnlistenRef.current) {
        queueUnlistenRef.current();
        queueUnlistenRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const setup = async () => {
      // Clean up previous listener before setting up new one
      if (queueUnlistenRef.current) {
        queueUnlistenRef.current();
        queueUnlistenRef.current = null;
      }

      const unlisten = await listen<QueueStatusPayload>(EventName.QUEUE_STATUS, (event) => {
        if (cancelled) return;
        const payload = event.payload;
        const store = useAgentStore.getState();
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
  }, [activeExecutionId]);

  // Disconnect listeners when persona changes to prevent cross-contamination.
  // The execution keeps running in the backend; we just stop piping its output
  // into the terminal that now belongs to a different persona.
  useEffect(() => {
    if (selectedPersonaId !== prevPersonaIdRef.current) {
      if (prevPersonaIdRef.current !== null) {
        const store = useAgentStore.getState();
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
