import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { PersonaTestRun } from "@/lib/bindings/PersonaTestRun";
import type { PersonaTestResult } from "@/lib/bindings/PersonaTestResult";
import * as api from "@/api/tauriApi";

export interface TestRunProgress {
  runId?: string;
  phase: string;
  scenariosCount?: number;
  current?: number;
  total?: number;
  modelId?: string;
  scenarioName?: string;
  status?: string;
  scores?: { tool_accuracy?: number; output_quality?: number; protocol_compliance?: number };
  summary?: Record<string, unknown>;
  error?: string;
}

export interface TestSlice {
  // State
  testRuns: PersonaTestRun[];
  activeTestResults: PersonaTestResult[];
  isTestRunning: boolean;
  testRunProgress: TestRunProgress | null;

  // Actions
  fetchTestRuns: (personaId: string) => Promise<void>;
  startTest: (personaId: string, models: api.ModelTestConfig[], useCaseFilter?: string) => Promise<string | null>;
  cancelTest: (runId: string) => Promise<void>;
  fetchTestResults: (testRunId: string) => Promise<void>;
  deleteTest: (runId: string) => Promise<void>;
  setTestRunProgress: (progress: TestRunProgress | null) => void;
  finishTestRun: () => void;
}

export const createTestSlice: StateCreator<PersonaStore, [], [], TestSlice> = (set, get) => ({
  testRuns: [],
  activeTestResults: [],
  isTestRunning: false,
  testRunProgress: null,

  fetchTestRuns: async (personaId) => {
    try {
      const runs = await api.listTestRuns(personaId);
      set({ testRuns: runs });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch test runs") });
    }
  },

  startTest: async (personaId, models, useCaseFilter) => {
    set({ isTestRunning: true, testRunProgress: null, activeTestResults: [], error: null });
    try {
      const run = await api.startTestRun(personaId, models, useCaseFilter);
      return run.id;
    } catch (err) {
      set({ error: errMsg(err, "Failed to start test run"), isTestRunning: false });
      return null;
    }
  },

  cancelTest: async (runId) => {
    try {
      await api.cancelTestRun(runId);
      set({ isTestRunning: false, testRunProgress: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel test run") });
    }
  },

  fetchTestResults: async (testRunId) => {
    try {
      const results = await api.getTestResults(testRunId);
      set({ activeTestResults: results });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch test results") });
    }
  },

  deleteTest: async (runId) => {
    try {
      await api.deleteTestRun(runId);
      set((state) => ({
        testRuns: state.testRuns.filter((r) => r.id !== runId),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete test run") });
    }
  },

  setTestRunProgress: (progress) => {
    set({ testRunProgress: progress });
  },

  finishTestRun: () => {
    set({ isTestRunning: false });
    const personaId = get().selectedPersona?.id;
    if (personaId) get().fetchTestRuns(personaId);
  },
});
