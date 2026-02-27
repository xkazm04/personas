import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { PersonaTestRun } from "@/lib/bindings/PersonaTestRun";
import type { PersonaTestResult } from "@/lib/bindings/PersonaTestResult";
import type { PersonaTestSuite } from "@/lib/bindings/PersonaTestSuite";
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
  scenarios?: unknown[];
}

export interface TestSlice {
  // State
  testRuns: PersonaTestRun[];
  activeTestResults: PersonaTestResult[];
  isTestRunning: boolean;
  testRunProgress: TestRunProgress | null;
  testSuites: PersonaTestSuite[];

  // Actions
  fetchTestRuns: (personaId: string) => Promise<void>;
  startTest: (personaId: string, models: api.ModelTestConfig[], useCaseFilter?: string, suiteId?: string) => Promise<string | null>;
  cancelTest: (runId: string) => Promise<void>;
  fetchTestResults: (testRunId: string) => Promise<void>;
  deleteTest: (runId: string) => Promise<void>;
  setTestRunProgress: (progress: TestRunProgress | null) => void;
  finishTestRun: () => void;
  fetchTestSuites: (personaId: string) => Promise<void>;
  createTestSuite: (personaId: string, name: string, scenarios: string, scenarioCount: number, sourceRunId?: string) => Promise<PersonaTestSuite | null>;
  deleteTestSuite: (id: string) => Promise<void>;
  updateTestSuite: (id: string, name?: string, description?: string, scenarios?: string, scenarioCount?: number) => Promise<PersonaTestSuite | null>;
}

export const createTestSlice: StateCreator<PersonaStore, [], [], TestSlice> = (set, get) => ({
  testRuns: [],
  activeTestResults: [],
  isTestRunning: false,
  testRunProgress: null,
  testSuites: [],

  fetchTestRuns: async (personaId) => {
    try {
      const runs = await api.listTestRuns(personaId);
      set({ testRuns: runs });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch test runs") });
    }
  },

  startTest: async (personaId, models, useCaseFilter, suiteId) => {
    set({ isTestRunning: true, testRunProgress: null, activeTestResults: [], error: null });
    try {
      const run = await api.startTestRun(personaId, models, useCaseFilter, suiteId);
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

  fetchTestSuites: async (personaId) => {
    try {
      const suites = await api.listTestSuites(personaId);
      set({ testSuites: suites });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch test suites") });
    }
  },

  createTestSuite: async (personaId, name, scenarios, scenarioCount, sourceRunId) => {
    try {
      const suite = await api.createTestSuite(personaId, name, scenarios, scenarioCount, undefined, sourceRunId);
      set((state) => ({ testSuites: [suite, ...state.testSuites] }));
      return suite;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create test suite") });
      return null;
    }
  },

  deleteTestSuite: async (id) => {
    try {
      await api.deleteTestSuite(id);
      set((state) => ({ testSuites: state.testSuites.filter((s) => s.id !== id) }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete test suite") });
    }
  },

  updateTestSuite: async (id, name, description, scenarios, scenarioCount) => {
    try {
      const updated = await api.updateTestSuite(id, name, description, scenarios, scenarioCount);
      set((state) => ({ testSuites: state.testSuites.map((s) => (s.id === updated.id ? updated : s)) }));
      return updated;
    } catch (err) {
      set({ error: errMsg(err, "Failed to update test suite") });
      return null;
    }
  },
});
