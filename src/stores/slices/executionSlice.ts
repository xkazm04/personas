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

export interface ExecutionSlice {
  // State
  executions: DbPersonaExecution[];
  activeExecutionId: string | null;
  executionPersonaId: string | null;
  activeUseCaseId: string | null;
  executionOutput: string[];
  isExecuting: boolean;
  /** Pipeline trace for the active execution (observability). */
  pipelineTrace: PipelineTrace | null;

  // Actions
  executePersona: (personaId: string, inputData?: object, useCaseId?: string, continuation?: Continuation) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
  finishExecution: (status?: string) => void;
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;
}

export const createExecutionSlice: StateCreator<PersonaStore, [], [], ExecutionSlice> = (set, get) => ({
  executions: [],
  activeExecutionId: null,
  executionPersonaId: null,
  activeUseCaseId: null,
  executionOutput: [],
  isExecuting: false,
  pipelineTrace: null,

  executePersona: async (personaId, inputData, useCaseId, continuation) => {
    // Pipeline: initiate stage
    let trace = createPipelineTrace('pending');
    trace = traceStage(trace, 'initiate', { personaId });

    set({ isExecuting: true, executionOutput: [], error: null, executionPersonaId: personaId, activeUseCaseId: useCaseId ?? null, pipelineTrace: trace });
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
      await api.cancelExecution(executionId);
      const trace = get().pipelineTrace;
      if (trace) {
        set({ pipelineTrace: completeTrace(traceStage(trace, 'finalize_status', { cancelled: true })) });
      }
      set({ isExecuting: false, activeExecutionId: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel execution") });
    }
  },

  finishExecution: (_status?: string) => {
    // Pipeline: frontend_complete stage
    let trace = get().pipelineTrace;
    if (trace) {
      trace = traceStage(trace, 'frontend_complete', { status: _status });
      trace = completeTrace(trace);
      set({ pipelineTrace: trace });
    }
    set({ isExecuting: false, activeUseCaseId: null });
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
    set((state) => {
      const MAX_OUTPUT_LINES = 5_000;
      const prev = state.executionOutput;
      if (prev.length < MAX_OUTPUT_LINES) {
        return { executionOutput: [...prev, line] };
      }
      // Drop oldest lines to stay within cap
      const next = prev.slice(prev.length - MAX_OUTPUT_LINES + 1);
      next.push(line);
      return { executionOutput: next };
    });
  },

  clearExecutionOutput: () => {
    set({ executionOutput: [], activeExecutionId: null, isExecuting: false, executionPersonaId: null, activeUseCaseId: null, pipelineTrace: null });
  },
});
