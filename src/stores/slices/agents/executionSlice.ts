import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { useSystemStore } from "../../systemStore";
import { reportError } from "../../storeTypes";
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
import { detectDesignDrift, loadDriftEvents, saveDriftEvents } from "@/lib/design/designDrift";
import type { AgentIR } from "@/lib/types/designTypes";
import { cancelExecution, executePersona, listExecutions } from "@/api/agents/executions";

import { executionSink } from "@/lib/execution/executionSink";
import { classifyLine } from "@/lib/utils/terminalColors";

/** Queue status event emitted from the engine when an execution is queued/promoted. */
export interface QueueStatusPayload {
  execution_id: string;
  persona_id: string;
  action: "queued" | "promoted" | "queue_full";
  position: number | null;
  queue_depth: number;
}

export interface ExecutionSlice {
  // State
  executions: PersonaExecution[];
  activeExecutionId: string | null;
  executionPersonaId: string | null;
  activeUseCaseId: string | null;
  executionOutput: string[];
  /** Total bytes accumulated in executionOutput (for budget enforcement). */
  executionOutputBytes: number;
  isExecuting: boolean;
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

  // Actions
  executePersona: (personaId: string, inputData?: object, useCaseId?: string, continuation?: Continuation) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
  finishExecution: (status?: string, statusData?: { durationMs?: number | null; costUsd?: number | null; errorMessage?: string | null }) => void;
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;
  setQueueStatus: (position: number | null, depth: number | null) => void;
  dismissDriftEvent: (eventId: string) => void;
}

export const createExecutionSlice: StateCreator<AgentStore, [], [], ExecutionSlice> = (set, get) => {
  // Bind the sink to push flushed output into the store.
  // On HMR / store recreation, re-binding automatically invalidates stale flushes.
  executionSink.reset();
  executionSink.bind((output, totalBytes) => {
    set({ executionOutput: output, executionOutputBytes: totalBytes });
  });

  return ({
  executions: [],
  activeExecutionId: null,
  executionPersonaId: null,
  activeUseCaseId: null,
  executionOutput: [],
  executionOutputBytes: 0,
  isExecuting: false,
  pipelineTrace: null,
  queuePosition: null,
  queueDepth: null,
  designDriftEvents: loadDriftEvents(),
  lastExecutionId: null,

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
    set({ isExecuting: true, executionOutput: [], executionOutputBytes: 0, error: null, executionPersonaId: personaId, activeUseCaseId: useCaseId ?? null });

    // Pipeline: initiate stage
    let trace = createPipelineTrace('pending');
    trace = traceStage(trace, 'initiate', { personaId });

    // Run initiate middleware (future: cost estimation, pre-flight checks)
    const initiatePayload: InitiatePayload = { personaId, inputData, useCaseId };
    await runMiddleware('initiate', initiatePayload, trace);

    set({ pipelineTrace: trace });
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

      const execution = await executePersona(
        personaId,
        undefined,
        validateResult.inputData ?? (inputData ? JSON.stringify(inputData) : undefined),
        useCaseId,
        continuation,
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

      set({ activeExecutionId: execution.id, pipelineTrace: trace });
      return execution.id;
    } catch (err) {
      trace = traceStage(trace, 'validate', undefined, String(err));
      trace = completeTrace(trace);
      reportError(err, "Failed to execute persona", set, { stateUpdates: { isExecuting: false, executionPersonaId: null, activeUseCaseId: null, pipelineTrace: trace } });
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
      set({ isExecuting: false, activeExecutionId: null, lastExecutionId: lastId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
      const personaId = get().selectedPersona?.id;
      if (personaId) get().fetchExecutions(personaId);
    }
  },

  finishExecution: (_status, statusData) => {
    // Force-flush any pending batch so the final output is visible before
    // we reset execution state.
    executionSink.forceFlush();

    // If a chat stream is active, finalize it now -- this runs at the store
    // level so it works even when ChatTab is unmounted (e.g. user switched tabs).
    const { chatStreaming, executionOutput: output, activeChatSessionId, executionPersonaId: chatPersonaId } = get();
    if (chatStreaming && activeChatSessionId && chatPersonaId) {
      const textLines = output.filter((l) => classifyLine(l) === 'text');
      const fullResponse = textLines.join('\n').trim();
      void get().finishChatStream(fullResponse, chatPersonaId, activeChatSessionId, get().activeExecutionId ?? undefined);
    }

    // Capture context for drift detection before resetting state
    const execPersonaId = get().executionPersonaId;
    const execId = get().activeExecutionId;

    // Pipeline: frontend_complete stage
    let trace = get().pipelineTrace;
    if (trace) {
      trace = traceStage(trace, 'frontend_complete', { status: _status });
      trace = completeTrace(trace);
      set({ pipelineTrace: trace });

      // Run frontend_complete middleware (fire-and-forget -- non-blocking)
      const completePayload: FrontendCompletePayload = { executionId: execId ?? '', finalStatus: _status ?? '' };
      void runMiddleware('frontend_complete', completePayload, trace).catch((err) => {
        console.warn('[execution] frontend_complete middleware failed', { executionId: execId, personaId: execPersonaId, error: String(err) });
      });
    }
    // Snapshot executions before fetchExecutions can overwrite store state,
    // so drift detection uses a consistent view of pre-refresh data.
    const snapshotExecutions = get().executions;

    set({ isExecuting: false, activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
    const personaId = get().selectedPersona?.id;
    if (personaId) get().fetchExecutions(personaId);
    // Notify guided tour that an execution completed
    useSystemStore.getState().emitTourEvent('tour:execution-complete');

    // Invalidate budget cache so spend data refreshes after execution
    get().invalidateBudgetCache(execPersonaId ?? undefined);

    // Design drift detection uses the snapshotted executions to avoid a race
    // where a concurrent fetchExecutions overwrites get().executions.
    if (execPersonaId && execId && _status) {
      try {
        const persona = get().personas.find(p => p.id === execPersonaId);
        if (persona) {
          const durationMs = statusData?.durationMs ?? null;
          const costUsd = statusData?.costUsd ?? 0;
          const errorMessage = statusData?.errorMessage ?? null;

          // Count recent consecutive failures from the pre-refresh executions
          // snapshot, then prepend the just-finished status to account for it.
          const recentStatuses: string[] = [_status];
          const existingExecs = snapshotExecutions
            .filter(e => e.persona_id === execPersonaId)
            .slice(0, 4); // 4 + 1 current = 5 total window
          for (const e of existingExecs) {
            recentStatuses.push(e.status);
          }
          let recentFailureCount = 0;
          for (const s of recentStatuses) {
            if (s === 'failed') recentFailureCount++;
            else break;
          }

          let lastDesignResult: AgentIR | null = null;
          if (persona.last_design_result) {
            try { lastDesignResult = JSON.parse(persona.last_design_result); } catch { /* ignore */ }
          }

          const driftEvents = detectDesignDrift(
            {
              status: _status,
              durationMs,
              costUsd,
              errorMessage,
              toolSteps: null,
              executionId: execId,
            },
            {
              personaId: execPersonaId,
              personaName: persona.name,
              timeoutMs: persona.timeout_ms,
              maxBudgetUsd: persona.max_budget_usd ?? null,
              lastDesignResult,
              recentFailureCount,
            },
          );

          if (driftEvents.length > 0) {
            const all = [...get().designDriftEvents, ...driftEvents];
            saveDriftEvents(all);
            set({ designDriftEvents: all });
          }
        }
      } catch (err) {
        console.warn('[execution] drift detection failed', { executionId: execId, personaId: execPersonaId, error: String(err) });
      }
    }
  },

  fetchExecutions: async (personaId) => {
    try {
      const executions = await listExecutions(personaId);
      set({ executions });
    } catch (err) {
      reportError(err, "Failed to fetch executions", set);
    }
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
    set({ executionOutput: [], executionOutputBytes: 0, activeExecutionId: null, isExecuting: false, executionPersonaId: null, activeUseCaseId: null, pipelineTrace: null, queuePosition: null, queueDepth: null });
  },

  setQueueStatus: (position, depth) => {
    set({ queuePosition: position, queueDepth: depth });
  },

  dismissDriftEvent: (eventId) => {
    const updated = get().designDriftEvents.map((e) =>
      e.id === eventId ? { ...e, dismissed: true } : e,
    );
    saveDriftEvents(updated);
    set({ designDriftEvents: updated });
  },
});
};
