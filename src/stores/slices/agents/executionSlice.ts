import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("execution");
import type { PersonaExecution } from "@/lib/types/types";
import type { PipelineTrace } from "@/lib/execution/pipeline";
import {
  createPipelineTrace,
  traceStage,
  completeTrace,
  runMiddleware,
} from "@/lib/execution/pipeline";
import type {
  InitiatePayload,
  CreateRecordPayload,
  SpawnEnginePayload,
  FrontendCompletePayload,
} from "@/lib/execution/pipeline";
import type { Continuation } from "@/lib/bindings/Continuation";
import type { DesignDriftEvent } from "@/lib/design/designDrift";
import { loadDriftEvents, saveDriftEvents } from "@/lib/design/designDrift";
import { cancelExecution, executePersona, getExecution, listExecutions } from "@/api/agents/executions";

import { executionSink } from "@/lib/execution/executionSink";
import { TERMINAL_STATUS_SET } from "@/lib/execution/executionState";
import { classifyLine } from "@/lib/utils/terminalColors";
import { createRunLifecycle } from "./runLifecycle";

const executionLifecycle = createRunLifecycle('isExecuting', 'executionProgress');

/** Queue status event emitted from the engine when an execution is queued/promoted. */
export interface QueueStatusPayload {
  execution_id: string;
  persona_id: string;
  action: "queued" | "promoted" | "queue_full";
  position: number | null;
  queue_depth: number;
}

/** Structured progress for the execution lifecycle -- analogous to TestRunProgress / LabRunProgress. */
export interface ExecutionRunProgress {
  executionId?: string;
  phase: string;
  pipelineStage?: string;
  status?: string;
  error?: string;
}

export interface ExecutionSlice {
  // State
  executions: PersonaExecution[];
  /** Whether the execution list is currently being fetched. */
  executionsLoading: boolean;
  /** The personaId whose executions are currently loaded (for cache coherence). */
  executionsPersonaId: string | null;
  activeExecutionId: string | null;
  executionPersonaId: string | null;
  activeUseCaseId: string | null;
  executionOutput: string[];
  /** Total bytes accumulated in executionOutput (for budget enforcement). */
  executionOutputBytes: number;
  /**
   * Per-execution output snapshots, keyed by execution ID.
   * Populated by `finishExecution` so that DAG walkers can retrieve
   * output for a completed execution even after the shared
   * `executionOutput` array has been cleared by a subsequent run.
   */
  completedExecutionOutputs: Record<string, string[]>;
  isExecuting: boolean;
  /** Structured progress tracking (managed by RunLifecycle). */
  executionProgress: ExecutionRunProgress | null;
  /** Pipeline trace for the active execution (observability). */
  pipelineTrace: PipelineTrace | null;
  /** Queue position for the active execution (null = not queued / running). */
  queuePosition: number | null;
  /** Total queue depth when queued. */
  queueDepth: number | null;
  /** Design drift events detected from execution outcomes. */
  designDriftEvents: DesignDriftEvent[];
  /** Last completed/cancelled execution ID -- survives state reset so Resume can fetch its session. */
  lastExecutionId: string | null;
  /** True when startup recovery could not reach the backend to verify a recovered execution. */
  executionVerificationFailed: boolean;

  // Actions
  executePersona: (personaId: string, inputData?: object, useCaseId?: string, continuation?: Continuation) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
  finishExecution: (status?: string, statusData?: { durationMs?: number | null; costUsd?: number | null; errorMessage?: string | null }) => void;
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;
  setQueueStatus: (position: number | null, depth: number | null) => void;
  setExecutionProgress: (progress: ExecutionRunProgress | null) => void;
  dismissDriftEvent: (eventId: string) => void;
  /** Retrieve and remove a completed execution's output snapshot (one-shot read). */
  consumeCompletedOutput: (executionId: string) => string[] | undefined;
  /** Retry verifying a recovered execution after a previous network failure. */
  retryExecutionVerification: () => Promise<void>;
  /** Dismiss the verification failure and abandon the recovered execution. */
  dismissVerificationFailure: () => void;
}

export const createExecutionSlice: StateCreator<AgentStore, [], [], ExecutionSlice> = (set, get) => {
  // Bind the sink to push flushed output into the store.
  // On HMR / store recreation, re-binding automatically invalidates stale flushes.
  executionSink.reset();
  executionSink.bind((output, totalBytes) => {
    set({ executionOutput: output, executionOutputBytes: totalBytes });
  });

  // Recovery: restore active execution state from localStorage
  const recoveredState = (() => {
    try {
      const stored = localStorage.getItem('personas:active-execution');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.activeExecutionId && parsed.isExecuting) {
          return {
            activeExecutionId: parsed.activeExecutionId as string,
            executionPersonaId: parsed.executionPersonaId as string | null,
            isExecuting: true,
          };
        }
      }
    } catch { /* ignore corrupt localStorage */ }
    return null;
  })();

  // Reconcile recovered execution against the backend. If the execution already
  // reached a terminal state (completed/cancelled/failed) while the app was closed,
  // clear the stale isExecuting flag so the UI doesn't show a phantom active run.

  if (recoveredState) {
    const { activeExecutionId, executionPersonaId } = recoveredState;
    // Fire-and-forget -- reconciliation should not block store creation.
    void (async () => {
      try {
        const execution = await getExecution(activeExecutionId, executionPersonaId ?? activeExecutionId);
        if (TERMINAL_STATUS_SET.has(execution.status)) {
          logger.info("Recovered execution already finished — clearing stale state", { executionId: activeExecutionId, status: execution.status });
          executionLifecycle.markFinished(set);
          set({ activeExecutionId: null, lastExecutionId: activeExecutionId, executionPersonaId: null });
          try { localStorage.removeItem('personas:active-execution'); } catch { /* ignore */ }
        } else {
          logger.info("Recovered execution still active — keeping state", { executionId: activeExecutionId, status: execution.status });
        }
      } catch {
        // Backend unreachable — do NOT clear execution state. The execution may
        // still be running and consuming resources. Set a flag so the UI can
        // show a retry prompt instead of silently abandoning the job.
        logger.warn("Could not verify recovered execution — flagging for retry", { executionId: activeExecutionId });
        set({ executionVerificationFailed: true });
      }
    })();
  }

  // Deduplication: track in-flight fetch so concurrent callers reuse the same promise.
  let inflightFetch: { personaId: string; promise: Promise<void> } | null = null;

  return ({
  executions: [],
  executionsLoading: false,
  executionsPersonaId: null,
  activeExecutionId: recoveredState?.activeExecutionId ?? null,
  executionPersonaId: recoveredState?.executionPersonaId ?? null,
  activeUseCaseId: null,
  executionOutput: [],
  executionOutputBytes: 0,
  completedExecutionOutputs: {},
  isExecuting: recoveredState?.isExecuting ?? false,
  executionProgress: null,
  pipelineTrace: null,
  queuePosition: null,
  queueDepth: null,
  designDriftEvents: loadDriftEvents(),
  lastExecutionId: null,
  executionVerificationFailed: false,

  executePersona: async (personaId, inputData, useCaseId, continuation) => {
    // Guard: reject concurrent executions. The store tracks a single active
    // execution -- a second call would overwrite activeExecutionId and
    // executionPersonaId, corrupting terminal output with interleaved lines.
    if (get().isExecuting) {
      set({ error: "Another execution is already running. Wait for it to complete or cancel it first." });
      return null;
    }

    // Budget enforcement: block execution when monthly spend exceeds budget
    // unless user has explicitly overridden for this session.
    if (get().isBudgetBlocked(personaId)) {
      set({ error: "Monthly budget exceeded for this agent. Override the budget pause in the agent settings or increase the budget to continue." });
      return null;
    }

    // Lock execution state immediately before any async work to close the
    // race-window where a second call could pass the isExecuting guard.
    executionSink.reset();
    executionLifecycle.markStarted(set);
    set({ executionOutput: [], executionOutputBytes: 0, executionPersonaId: personaId, activeUseCaseId: useCaseId ?? null });

    // Pipeline: initiate stage
    let trace = createPipelineTrace('pending');
    trace = traceStage(trace, 'initiate', { personaId });

    // Run initiate middleware (future: cost estimation, pre-flight checks)
    const initiatePayload: InitiatePayload = { personaId, inputData, useCaseId };
    await runMiddleware('initiate', initiatePayload, trace);

    set({ pipelineTrace: trace, executionProgress: { phase: 'initiating', pipelineStage: 'initiate' } });
    try {
      // Pipeline: validate stage -- middleware can enrich inputData (e.g. knowledge injection)
      trace = traceStage(trace, 'validate');
      const validateResult = await runMiddleware('validate', {
        personaId,
        personaName: '',
        triggerId: null,
        inputData: inputData ? JSON.stringify(inputData) : null,
        useCaseId: useCaseId ?? null,
        modelUsed: null,
      }, trace);

      // Generate an idempotency key so that if the IPC times out and the user
      // retries, the backend returns the already-created execution instead of
      // spawning a duplicate.
      const idempotencyKey = crypto.randomUUID();

      const execution = await executePersona(
        personaId,
        undefined,
        validateResult.inputData ?? (inputData ? JSON.stringify(inputData) : undefined),
        useCaseId,
        continuation,
        idempotencyKey,
      );

      // Pipeline: create_record stage
      trace = traceStage(trace, 'create_record', { executionId: execution.id });
      const createPayload: CreateRecordPayload = { executionId: execution.id, execution: execution as never };
      await runMiddleware('create_record', createPayload, trace);

      // Pipeline: spawn_engine stage
      trace = traceStage(trace, 'spawn_engine');
      const spawnPayload: SpawnEnginePayload = { executionId: execution.id, taskSpawned: true };
      await runMiddleware('spawn_engine', spawnPayload, trace);

      trace = { ...trace, executionId: execution.id };

      set({ activeExecutionId: execution.id, pipelineTrace: trace, executionProgress: { executionId: execution.id, phase: 'running', pipelineStage: 'spawn_engine' } });
      // Persist to localStorage for recovery after refresh
      try {
        localStorage.setItem('personas:active-execution', JSON.stringify({
          activeExecutionId: execution.id,
          executionPersonaId: personaId,
          isExecuting: true,
        }));
      } catch { /* ignore */ }
      return execution.id;
    } catch (err) {
      trace = traceStage(trace, 'validate', undefined, String(err));
      trace = completeTrace(trace);
      executionLifecycle.markFailed(set);
      reportError(err, "Failed to execute persona", set, { stateUpdates: { executionPersonaId: null, activeUseCaseId: null, pipelineTrace: trace } });
      return null;
    }
  },

  cancelExecution: async (executionId) => {
    try {
      const callerPersonaId = get().executionPersonaId ?? '';
      await cancelExecution(executionId, callerPersonaId);
      const trace = get().pipelineTrace;
      if (trace) {
        set({ pipelineTrace: completeTrace(traceStage(trace, 'finalize_status', { cancelled: true })) });
      }
    } catch (err) {
      reportError(err, "Failed to cancel execution", set);
    } finally {
      // If a chat stream is active, finalize it before clearing state.
      const { chatStreaming: streaming, activeChatSessionId: sid, executionPersonaId: pid, executionOutput: out } = get();
      if (streaming && sid && pid) {
        const textLines = out.filter((l) => classifyLine(l) === 'text');
        const fullResponse = textLines.join('\n').trim();
        void get().finishChatStream(fullResponse, pid, sid, get().activeExecutionId ?? undefined);
      }

      // Preserve the execution ID for Resume before clearing active state.
      const lastId = get().activeExecutionId;
      // Always reset execution state regardless of API success/failure.
      executionLifecycle.markCancelled(set);
      set({ activeExecutionId: null, lastExecutionId: lastId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
      try { localStorage.removeItem('personas:active-execution'); } catch { /* ignore */ }
      const personaId = get().selectedPersona?.id;
      if (personaId) get().fetchExecutions(personaId);
    }
  },

  finishExecution: (_status, statusData) => {
    // Force-flush any pending batch so the final output is visible before
    // we reset execution state.
    executionSink.forceFlush();

    // Snapshot the output for this execution so DAG walkers can retrieve it
    // after the shared executionOutput array is cleared by the next run.
    const finishedExecId = get().activeExecutionId;
    if (finishedExecId) {
      const snapshot = [...get().executionOutput];
      set({
        completedExecutionOutputs: {
          ...get().completedExecutionOutputs,
          [finishedExecId]: snapshot,
        },
      });
    }

    // If a chat stream is active, finalize it now -- this runs at the store
    // level so it works even when ChatTab is unmounted (e.g. user switched tabs).
    const { chatStreaming, executionOutput: output, activeChatSessionId, executionPersonaId: chatPersonaId } = get();
    if (chatStreaming && activeChatSessionId && chatPersonaId) {
      const textLines = output.filter((l) => classifyLine(l) === 'text');
      const fullResponse = textLines.join('\n').trim();
      void get().finishChatStream(fullResponse, chatPersonaId, activeChatSessionId, get().activeExecutionId ?? undefined);
    }

    // Capture context for drift detection before resetting state.
    // Snapshot executions now so drift middleware doesn't read stale/wrong data
    // after the state reset below (the store's executions list may be refreshed
    // or belong to a different persona by the time middleware runs).
    const execPersonaId = get().executionPersonaId;
    const execId = get().activeExecutionId;
    const recentExecutions = execPersonaId
      ? get().executions
          .filter((e) => e.persona_id === execPersonaId)
          .slice(0, 4)
          .map((e) => ({ persona_id: e.persona_id, status: e.status }))
      : [];

    // Pipeline: frontend_complete stage
    let trace = get().pipelineTrace;
    if (trace) {
      trace = traceStage(trace, 'frontend_complete', { status: _status });
      trace = completeTrace(trace);
      set({ pipelineTrace: trace });
    }

    // Run frontend_complete middleware BEFORE resetting state so that
    // middleware (e.g. drift detection) can read persona data from the store
    // while execution context is still intact.
    if (trace) {
      const completePayload: FrontendCompletePayload = {
        executionId: execId ?? '',
        finalStatus: _status ?? '',
        personaId: execPersonaId ?? undefined,
        durationMs: statusData?.durationMs,
        costUsd: statusData?.costUsd,
        errorMessage: statusData?.errorMessage,
        recentExecutions,
      };
      void runMiddleware('frontend_complete', completePayload, trace).catch((err) => {
        logger.warn("frontend_complete middleware failed", { executionId: execId, personaId: execPersonaId, error: String(err) });
      });
    }

    executionLifecycle.markFinished(set);
    set({ activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
    const personaId = get().selectedPersona?.id;
    if (personaId) get().fetchExecutions(personaId);
    get().fetchPersonaSummaries();

    // Clear recovery state
    try { localStorage.removeItem('personas:active-execution'); } catch { /* ignore */ }
  },

  fetchExecutions: async (personaId) => {
    // Deduplicate: if already fetching for the same persona, reuse in-flight promise.
    if (inflightFetch && inflightFetch.personaId === personaId) {
      return inflightFetch.promise;
    }
    const doFetch = async () => {
      set({ executionsLoading: true });
      try {
        const executions = await listExecutions(personaId);
        set({ executions, executionsPersonaId: personaId });
      } catch (err) {
        reportError(err, "Failed to fetch executions", set);
      } finally {
        set({ executionsLoading: false });
        inflightFetch = null;
      }
    };
    const promise = doFetch();
    inflightFetch = { personaId, promise };
    return promise;
  },

  appendExecutionOutput: (line) => {
    executionSink.append(line);
  },

  clearExecutionOutput: () => {
    // If an execution is still running, cancel it on the backend first to
    // avoid orphaning the engine (which would keep consuming API credits).
    const activeId = get().activeExecutionId;
    if (activeId && get().isExecuting) {
      get().cancelExecution(activeId);
    }
    executionSink.clear();
    executionLifecycle.markCancelled(set);
    set({ executionOutput: [], executionOutputBytes: 0, activeExecutionId: null, executionPersonaId: null, activeUseCaseId: null, pipelineTrace: null, queuePosition: null, queueDepth: null });
  },

  setQueueStatus: (position, depth) => {
    set({ queuePosition: position, queueDepth: depth });
  },

  setExecutionProgress: (progress) => {
    set({ executionProgress: progress });
  },

  dismissDriftEvent: (eventId) => {
    const updated = get().designDriftEvents.map((e) =>
      e.id === eventId ? { ...e, dismissed: true } : e,
    );
    saveDriftEvents(updated);
    set({ designDriftEvents: updated });
  },

  consumeCompletedOutput: (executionId) => {
    const map = get().completedExecutionOutputs;
    const output = map[executionId];
    if (output) {
      const { [executionId]: _, ...rest } = map;
      set({ completedExecutionOutputs: rest });
    }
    return output;
  },

  retryExecutionVerification: async () => {
    const execId = get().activeExecutionId;
    const personaId = get().executionPersonaId;
    if (!execId) {
      // Nothing to verify — clear the flag.
      set({ executionVerificationFailed: false });
      return;
    }
    try {
      const execution = await getExecution(execId, personaId ?? execId);
      set({ executionVerificationFailed: false });
      if (TERMINAL_STATUS_SET.has(execution.status)) {
        logger.info("Recovered execution already finished — clearing stale state", { executionId: execId, status: execution.status });
        executionLifecycle.markFinished(set);
        set({ activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null });
        try { localStorage.removeItem('personas:active-execution'); } catch { /* ignore */ }
      } else {
        logger.info("Recovered execution still active — keeping state", { executionId: execId, status: execution.status });
      }
    } catch {
      logger.warn("Retry verification failed — backend still unreachable", { executionId: execId });
      // Keep the flag set so the user can retry again.
    }
  },

  dismissVerificationFailure: () => {
    const execId = get().activeExecutionId;
    logger.info("User dismissed verification failure — abandoning recovered execution", { executionId: execId });
    set({ executionVerificationFailed: false });
    executionLifecycle.markFinished(set);
    set({ activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null });
    try { localStorage.removeItem('personas:active-execution'); } catch { /* ignore */ }
  },
});
};
