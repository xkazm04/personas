import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { DbPersonaExecution } from "@/lib/types/types";
import type { PipelineTrace } from "@/lib/execution/pipeline";
import {
  createPipelineTrace,
  traceStage,
  completeTrace,
} from "@/lib/execution/pipeline";
import type { Continuation } from "@/lib/bindings/Continuation";
import * as api from "@/api/tauriApi";

/** Maximum terminal output lines kept in memory to prevent OOM on long executions. */
const MAX_TERMINAL_LINES = 5000;
/** Maximum length of a single terminal line in characters. */
const MAX_LINE_LENGTH = 4096;
/** Maximum total bytes tracked across all terminal lines (~10 MB). */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

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
      return {};
    }

    const newBytes = Math.min(state.executionOutputBytes + bytesToFlush, MAX_TOTAL_BYTES);
    const combined = state.executionOutput.concat(linesToFlush);
    const output = combined.length > MAX_TERMINAL_LINES
      ? combined.slice(combined.length - MAX_TERMINAL_LINES)
      : combined;

    return { executionOutput: output, executionOutputBytes: newBytes };
  });
}

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

  // Actions
  executePersona: (personaId: string, inputData?: object, useCaseId?: string, continuation?: Continuation) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
  finishExecution: (status?: string) => void;
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;
  setQueueStatus: (position: number | null, depth: number | null) => void;
}

export const createExecutionSlice: StateCreator<PersonaStore, [], [], ExecutionSlice> = (set, get) => {
  // Capture set for the module-level batch flush function.
  _sliceSet = set;

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

  executePersona: async (personaId, inputData, useCaseId, continuation) => {
    // Guard: reject concurrent executions. The store tracks a single active
    // execution — a second call would overwrite activeExecutionId and
    // executionPersonaId, corrupting terminal output with interleaved lines.
    if (get().isExecuting) {
      set({ error: "Another execution is already running. Wait for it to complete or cancel it first." });
      return null;
    }

    // Pipeline: initiate stage
    let trace = createPipelineTrace('pending');
    trace = traceStage(trace, 'initiate', { personaId });

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
      trace = { ...trace, executionId: execution.id };

      set({ activeExecutionId: execution.id, pipelineTrace: trace });
      return execution.id;
    } catch (err) {
      trace = traceStage(trace, 'validate', undefined, String(err));
      trace = completeTrace(trace);
      set({ error: errMsg(err, "Failed to execute persona"), isExecuting: false, activeUseCaseId: null, pipelineTrace: trace });
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
      // Always reset execution state regardless of API success/failure.
      // Event listeners may already be torn down (disconnect() called before
      // cancel), so we cannot rely on finishExecution from the backend event.
      set({ isExecuting: false, activeExecutionId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
      const personaId = get().selectedPersona?.id;
      if (personaId) get().fetchExecutions(personaId);
    }
  },

  finishExecution: (_status?: string) => {
    // Force-flush any pending batch so the final output is visible before
    // we reset execution state.
    flushTerminalBatch();

    // Pipeline: frontend_complete stage
    let trace = get().pipelineTrace;
    if (trace) {
      trace = traceStage(trace, 'frontend_complete', { status: _status });
      trace = completeTrace(trace);
      set({ pipelineTrace: trace });
    }
    set({ isExecuting: false, activeExecutionId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null });
    const personaId = get().selectedPersona?.id;
    if (personaId) get().fetchExecutions(personaId);
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
    set({ executionOutput: [], executionOutputBytes: 0, activeExecutionId: null, isExecuting: false, executionPersonaId: null, activeUseCaseId: null, pipelineTrace: null, queuePosition: null, queueDepth: null });
  },

  setQueueStatus: (position, depth) => {
    set({ queuePosition: position, queueDepth: depth });
  },
});
};
