import { useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAgentStore } from "@/stores/agentStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("persona-execution");
import { useCorrelatedCliStream } from './useCorrelatedCliStream';
import { EventName } from '@/lib/eventRegistry';
import { traceStage, runMiddleware, type FinalizeStatusPayload } from '@/lib/execution/pipeline';
import { isTerminalState } from '@/lib/execution/executionState';
import { validatePayload, ExecutionStatusSchema } from '@/lib/validation/eventPayloads';
import type { QueueStatusPayload } from '@/stores/slices/agents/executionSlice';
import { getExecutionLogLines } from '@/api/agents/executions';
import { checkNewHumanReviews } from '@/lib/notifications/checkHumanReviews';

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
        void runMiddleware('finalize_status', finalizePayload, trace).catch((err) => { logger.warn('finalize_status middleware failed', { executionId: store.activeExecutionId, error: String(err) }); });
      }
    }
    if (error) {
      store.appendExecutionOutput(`[ERROR] ${error}`);
    }

    // Capture persona info before finishExecution resets state
    const execPersonaId = store.executionPersonaId;
    const execPersonaName = store.selectedPersona?.name ?? null;

    store.finishExecution(status, {
      durationMs: duration_ms ?? null,
      costUsd: cost_usd ?? null,
      errorMessage: error ?? null,
    });

    // After successful execution, check for new human reviews
    if (status === 'completed' && execPersonaId) {
      void checkNewHumanReviews(execPersonaId, execPersonaName).catch(() => {});
    }
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

    // Replay log lines that were missed during reload, deduplicating against
    // lines already delivered by the real-time event bus stream.
    getExecutionLogLines(execId, personaId)
      .then((lines) => {
        const current = useAgentStore.getState().executionOutput;
        // Build a counted set so legitimately repeated identical lines are
        // handled correctly -- each existing occurrence "claims" one recovery
        // line, and only truly new lines are appended.
        const seen = new Map<string, number>();
        for (const existing of current) {
          seen.set(existing, (seen.get(existing) ?? 0) + 1);
        }

        const sink = useAgentStore.getState().appendExecutionOutput;
        for (const line of lines) {
          const count = seen.get(line) ?? 0;
          if (count > 0) {
            seen.set(line, count - 1);
          } else {
            sink(line);
          }
        }
      })
      .catch(() => {
        // Recovery failed -- execution may have completed during reload
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

  // Background execution status listener: catches status events for executions
  // that are running in the background (not the focused terminal execution).
  const bgUnlistenRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      if (bgUnlistenRef.current) { bgUnlistenRef.current(); bgUnlistenRef.current = null; }

      const unlisten = await listen<Record<string, unknown>>(EventName.EXECUTION_STATUS, (event) => {
        if (cancelled) return;
        const payload = event.payload;
        const execId = payload.execution_id as string | undefined;
        if (!execId) return;

        const store = useAgentStore.getState();
        // Skip if this is the focused execution (handled by the correlated stream)
        if (store.activeExecutionId === execId) return;

        // Check if this is a tracked background execution
        const bg = store.backgroundExecutions.find((b) => b.executionId === execId);
        if (!bg) return;

        const status = payload.status as string;
        if (isTerminalState(status)) {
          const mapped = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed';
          store.updateBackgroundExecution(execId, mapped);
          // Auto-remove after 10 seconds so the badge fades
          setTimeout(() => { useAgentStore.getState().removeBackgroundExecution(execId); }, 10_000);
          // Refresh execution list for the persona
          const personaId = store.selectedPersona?.id;
          if (personaId) store.fetchExecutions(personaId);
        } else if (status === 'running') {
          store.updateBackgroundExecution(execId, 'running');
        }
      });

      if (!cancelled) { bgUnlistenRef.current = unlisten; } else { unlisten(); }
    };
    void setup();
    return () => { cancelled = true; if (bgUnlistenRef.current) { bgUnlistenRef.current(); bgUnlistenRef.current = null; } };
  }, []);

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
