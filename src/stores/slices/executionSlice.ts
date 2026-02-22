import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { DbPersonaExecution } from "@/lib/types/types";
import * as api from "@/api/tauriApi";

export interface ExecutionSlice {
  // State
  executions: DbPersonaExecution[];
  activeExecutionId: string | null;
  executionOutput: string[];
  isExecuting: boolean;

  // Actions
  executePersona: (personaId: string, inputData?: object) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
  finishExecution: (status?: string) => void;
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;
}

export const createExecutionSlice: StateCreator<PersonaStore, [], [], ExecutionSlice> = (set, get) => ({
  executions: [],
  activeExecutionId: null,
  executionOutput: [],
  isExecuting: false,

  executePersona: async (personaId, inputData) => {
    set({ isExecuting: true, executionOutput: [], error: null });
    try {
      const execution = await api.executePersona(
        personaId,
        undefined,
        inputData ? JSON.stringify(inputData) : undefined,
      );
      set({ activeExecutionId: execution.id });
      return execution.id;
    } catch (err) {
      set({ error: errMsg(err, "Failed to execute persona"), isExecuting: false });
      return null;
    }
  },

  cancelExecution: async (executionId) => {
    try {
      await api.cancelExecution(executionId);
      set({ isExecuting: false, activeExecutionId: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel execution") });
    }
  },

  finishExecution: (_status?: string) => {
    set({ isExecuting: false });
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
    set({ executionOutput: [], activeExecutionId: null, isExecuting: false });
  },
});
