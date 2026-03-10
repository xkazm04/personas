import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { DbPersonaExecution } from "@/lib/types/types";
import type { PipelineTrace } from "@/lib/execution/pipeline";
import {
  createPipelineTrace,
  traceStage,
  completeTrace,
<<<<<<< HEAD
  runMiddleware,
} from "@/lib/execution/pipeline";
import type {
  InitiatePayload,
  CreateRecordPayload,
  SpawnEnginePayload,
  FrontendCompletePayload,
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
} from "@/lib/execution/pipeline";
import type { Continuation } from "@/lib/bindings/Continuation";
import type { DesignDriftEvent } from "@/lib/design/designDrift";
import { detectDesignDrift, loadDriftEvents, saveDriftEvents } from "@/lib/design/designDrift";
<<<<<<< HEAD
import type { AgentIR } from "@/lib/types/designTypes";
import * as api from "@/api/tauriApi";
import { executionSink } from "@/lib/execution/executionSink";
=======
import type { DesignAnalysisResult } from "@/lib/types/designTypes";
import * as api from "@/api/tauriApi";

/** Maximum terminal output lines kept in memory to prevent OOM on long executions. */
const MAX_TERMINAL_LINES = 10_000;
/** Maximum length of a single terminal line in characters. */
const MAX_LINE_LENGTH = 4096;
/** Maximum total bytes tracked across all terminal lines (~10 MB). */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const OUTPUT_TRUNCATION_NOTICE = "[SYSTEM] Output truncated - 10MB limit reached. Execution continues in background.";

// ---------------------------------------------------------------------------
// Batched terminal output – accumulates lines and flushes once per microtask
// so we pay the O(n) array cost only once per batch instead of per line.
// ---------------------------------------------------------------------------
interface TerminalBatch {
  lines: string[];
  bytes: number;
  scheduled: boolean;
}

const batch: TerminalBatch = { lines: [], bytes: 0, scheduled: false };
let truncationNoticeShown = false;

/** Captured Zustand set – assigned once inside `createExecutionSlice`. */
let _sliceSet: Parameters<StateCreator<PersonaStore, [], [], ExecutionSlice>>[0] | null = null;

function flushTerminalBatch() {
  batch.scheduled = false;
  if (batch.lines.length === 0 || !_sliceSet) return;

  const linesToFlush = batch.lines;
  const bytesToFlush = batch.bytes;
  batch.lines = [];
  batch.bytes = 0;

  _sliceSet((state) => {
    // Enforce total byte budget
    if (state.executionOutputBytes >= MAX_TOTAL_BYTES) {
      if (!truncationNoticeShown) {
        truncationNoticeShown = true;
        const nextOutput = state.executionOutput.concat(OUTPUT_TRUNCATION_NOTICE);
        return {
          executionOutput: nextOutput.length > MAX_TERMINAL_LINES
            ? nextOutput.slice(nextOutput.length - MAX_TERMINAL_LINES)
            : nextOutput,
        };
      }
      return {};
    }

    const newBytes = Math.min(state.executionOutputBytes + bytesToFlush, MAX_TOTAL_BYTES);
    const combined = state.executionOutput.concat(linesToFlush);
    let output = combined.length > MAX_TERMINAL_LINES
      ? combined.slice(combined.length - MAX_TERMINAL_LINES)
      : combined;

    if (newBytes >= MAX_TOTAL_BYTES && !truncationNoticeShown) {
      truncationNoticeShown = true;
      output = output.concat(OUTPUT_TRUNCATION_NOTICE);
      if (output.length > MAX_TERMINAL_LINES) {
        output = output.slice(output.length - MAX_TERMINAL_LINES);
      }
    }

    return { executionOutput: output, executionOutputBytes: newBytes };
  });
}
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
  executions: DbPersonaExecution[];
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
<<<<<<< HEAD
  /** Last completed/cancelled execution ID — survives state reset so Resume can fetch its session. */
  lastExecutionId: string | null;
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

  // Actions
  executePersona: (personaId: string, inputData?: object, useCaseId?: string, continuation?: Continuation) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
<<<<<<< HEAD
  finishExecution: (status?: string, statusData?: { durationMs?: number | null; costUsd?: number | null; errorMessage?: string | null }) => void;
=======
  finishExecution: (status?: string) => void;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;
  setQueueStatus: (position: number | null, depth: number | null) => void;
  dismissDriftEvent: (eventId: string) => void;
}

export const createExecutionSlice: StateCreator<PersonaStore, [], [], ExecutionSlice> = (set, get) => {
<<<<<<< HEAD
  // Bind the sink to push flushed output into the store.
  // On HMR / store recreation, re-binding automatically invalidates stale flushes.
  executionSink.reset();
  executionSink.bind((output, totalBytes) => {
    set({ executionOutput: output, executionOutputBytes: totalBytes });
  });
=======
  // Capture set for the module-level batch flush function.
  _sliceSet = set;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
<<<<<<< HEAD
  lastExecutionId: null,
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

  executePersona: async (personaId, inputData, useCaseId, continuation) => {
    // Guard: reject concurrent executions. The store tracks a single active
    // execution — a second call would overwrite activeExecutionId and
    // executionPersonaId, corrupting terminal output with interleaved lines.
    if (get().isExecuting) {
      set({ error: "Another execution is already running. Wait for it to complete or cancel it first." });
      return null;
    }

<<<<<<< HEAD
    // Budget enforcement: block execution when monthly spend exceeds budget
    // unless user has explicitly overridden for this session.
    if (get().isBudgetBlocked(personaId)) {
      set({ error: "Monthly budget exceeded for this agent. Override the budget pause in the agent settings or increase the budget to continue." });
      return null;
    }

=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
    // Pipeline: initiate stage
    let trace = createPipelineTrace('pending');
    trace = traceStage(trace, 'initiate', { personaId });

<<<<<<< HEAD
    // Run initiate middleware (future: cost estimation, pre-flight checks)
    const initiatePayload: InitiatePayload = { personaId, inputData, useCaseId };
    await runMiddleware('initiate', initiatePayload, trace);

    executionSink.reset();
    set({ isExecuting: true, executionOutput: [], executionOutputBytes: 0, error: null, executionPersonaId: personaId, activeUseCaseId: useCaseId ?? null, pipelineTrace: trace });
    try {
      // Pipeline: validate stage — middleware can enrich inputData (e.g. knowledge injection)
      trace = traceStage(trace, 'validate');
      const validateResult = await runMiddleware('validate', {
        personaId,
        personaName: '',
        triggerId: null,
        inputData: inputData ? JSON.stringify(inputData) : null,
        useCaseId: useCaseId ?? null,
        modelUsed: null,
      }, trace);

      const execution = await api.executePersona(
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

=======
    truncationNoticeShown = false;
    set({ isExecuting: true, executionOutput: [], executionOutputBytes: 0, error: null, executionPersonaId: personaId, activeUseCaseId: useCaseId ?? null, pipelineTrace: trace });
    try {
      // Pipeline: validate + create_record + spawn_engine happen in Tauri command
      trace = traceStage(trace, 'validate');
      const execution = await api.executePersona(
        personaId,
        undefined,
        inputData ? JSON.stringify(inputData) : undefined,
        useCaseId,
        continuation,
      );
      // Command returned — record, spawn, and stream stages are active
      trace = traceStage(trace, 'create_record', { executionId: execution.id });
      trace = traceStage(trace, 'spawn_engine');
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      trace = { ...trace, executionId: execution.id };

      set({ activeExecutionId: execution.id, pipelineTrace: trace });
      return execution.id;
    } catch (err) {
      trace = traceStage(trace, 'validate', undefined, String(err));
      trace = completeTrace(trace);
      set({ error: errMsg(err, "Failed to execute persona"), isExecuting: false, executionPersonaId: null, activeUseCaseId: null, pipelineTrace: trace });
      return null;
    }
  },

  cancelExecution: async (executionId) => {
    try {
      const callerPersonaId = get().executionPersonaId ?? '';
      await api.cancelExecution(executionId, callerPersonaId);
      const trace = get().pipelineTrace;
      if (trace) {
        set({ pipelineTrace: completeTrace(traceStage(trace, 'finalize_status', { cancelled: true })) });
      }
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel execution") });
    } finally {
<<<<<<< HEAD
      // Preserve the execution ID for Resume before clearing active state.
      const lastId = get().activeExecutionId;
      // Always reset execution state regardless of API success/failure.
      set({ isExecuting: false, activeExecutionId: null, lastExecutionId: lastId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
=======
      // Always reset execution state regardless of API success/failure.
      // Event listeners may already be torn down (disconnect() called before
      // cancel), so we cannot rely on finishExecution from the backend event.
      set({ isExecuting: false, activeExecutionId: null, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      const personaId = get().selectedPersona?.id;
      if (personaId) get().fetchExecutions(personaId);
    }
  },

<<<<<<< HEAD
  finishExecution: (_status, statusData) => {
    // Force-flush any pending batch so the final output is visible before
    // we reset execution state.
    executionSink.forceFlush();
=======
  finishExecution: (_status?: string) => {
    // Force-flush any pending batch so the final output is visible before
    // we reset execution state.
    flushTerminalBatch();
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

    // Capture context for drift detection before resetting state
    const execPersonaId = get().executionPersonaId;
    const execId = get().activeExecutionId;
<<<<<<< HEAD
=======
    const terminalOutput = get().executionOutput;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

    // Pipeline: frontend_complete stage
    let trace = get().pipelineTrace;
    if (trace) {
      trace = traceStage(trace, 'frontend_complete', { status: _status });
      trace = completeTrace(trace);
      set({ pipelineTrace: trace });
<<<<<<< HEAD

      // Run frontend_complete middleware (fire-and-forget — non-blocking)
      const completePayload: FrontendCompletePayload = { executionId: execId ?? '', finalStatus: _status ?? '' };
      void runMiddleware('frontend_complete', completePayload, trace).catch(() => {/* non-critical */});
    }
    set({ isExecuting: false, activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
=======
    }
    set({ isExecuting: false, activeExecutionId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
    const personaId = get().selectedPersona?.id;
    if (personaId) get().fetchExecutions(personaId);
    // Notify guided tour that an execution completed
    get().emitTourEvent('tour:execution-complete');

    // Design drift detection — async, non-blocking
    if (execPersonaId && execId && _status) {
<<<<<<< HEAD
      const durationMs = statusData?.durationMs ?? null;
      const costUsd = statusData?.costUsd ?? 0;
      const errorMessage = statusData?.errorMessage ?? null;

=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      queueMicrotask(() => {
        try {
          const state = get();
          const persona = state.personas.find(p => p.id === execPersonaId);
          if (!persona) return;

<<<<<<< HEAD
=======
          // Parse summary from terminal output to get cost/duration
          let durationMs: number | null = null;
          let costUsd = 0;
          let errorMessage: string | null = null;
          for (let i = terminalOutput.length - 1; i >= 0; i--) {
            const line = terminalOutput[i]!;
            if (line.startsWith('[SUMMARY]')) {
              try {
                const summary = JSON.parse(line.slice(9));
                durationMs = summary.duration_ms ?? null;
                costUsd = summary.cost_usd ?? 0;
              } catch { /* ignore parse errors */ }
            }
            if (line.startsWith('[ERROR]') && !errorMessage) {
              errorMessage = line.slice(8);
            }
          }

>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
          // Count recent consecutive failures for this persona
          const recentExecs = state.executions
            .filter(e => e.persona_id === execPersonaId)
            .slice(0, 5);
          let recentFailureCount = 0;
          for (const e of recentExecs) {
            if (e.status === 'failed') recentFailureCount++;
            else break;
          }

<<<<<<< HEAD
          let lastDesignResult: AgentIR | null = null;
=======
          let lastDesignResult: DesignAnalysisResult | null = null;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
        } catch {
          // Drift detection is non-critical — never break execution flow
        }
      });
    }
  },

  fetchExecutions: async (personaId) => {
    try {
      const executions = await api.listExecutions(personaId);
      set({ executions });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch executions") });
    }
  },

  appendExecutionOutput: (line) => {
<<<<<<< HEAD
    executionSink.append(line);
  },

  clearExecutionOutput: () => {
    executionSink.clear();
=======
    // Truncate overlong lines
    const safeLine = line.length > MAX_LINE_LENGTH
      ? line.slice(0, MAX_LINE_LENGTH) + "...[truncated]"
      : line;

    batch.lines.push(safeLine);
    batch.bytes += safeLine.length;

    if (!batch.scheduled) {
      batch.scheduled = true;
      queueMicrotask(flushTerminalBatch);
    }
  },

  clearExecutionOutput: () => {
    // Discard any pending batch so stale lines don't flush after clear
    batch.lines = [];
    batch.bytes = 0;
    batch.scheduled = false;
    truncationNoticeShown = false;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
