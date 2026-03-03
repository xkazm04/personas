import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { LabArenaRun } from "@/lib/bindings/LabArenaRun";
import type { LabArenaResult } from "@/lib/bindings/LabArenaResult";
import type { LabAbRun } from "@/lib/bindings/LabAbRun";
import type { LabAbResult } from "@/lib/bindings/LabAbResult";
import type { LabMatrixRun } from "@/lib/bindings/LabMatrixRun";
import type { LabMatrixResult } from "@/lib/bindings/LabMatrixResult";
import type { LabEvalRun } from "@/lib/bindings/LabEvalRun";
import type { LabEvalResult } from "@/lib/bindings/LabEvalResult";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { ModelTestConfig } from "@/api/tests";
import * as api from "@/api/tauriApi";

const LAB_RUN_MAX_DURATION_MS = 30 * 60 * 1000;
let labRunSafetyTimeoutId: ReturnType<typeof setTimeout> | null = null;

function clearLabRunSafetyTimeout() {
  if (labRunSafetyTimeoutId) {
    clearTimeout(labRunSafetyTimeoutId);
    labRunSafetyTimeoutId = null;
  }
}

function scheduleLabRunSafetyTimeout(onTimeout: () => void) {
  clearLabRunSafetyTimeout();
  labRunSafetyTimeoutId = setTimeout(() => {
    labRunSafetyTimeoutId = null;
    onTimeout();
  }, LAB_RUN_MAX_DURATION_MS);
}

export type LabMode = "arena" | "ab" | "matrix" | "eval" | "versions";

export interface LabRunProgress {
  runId?: string;
  mode: LabMode;
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

export interface LabSlice {
  // Mode
  labMode: LabMode;
  setLabMode: (mode: LabMode) => void;

  // Shared running state
  isLabRunning: boolean;
  labProgress: LabRunProgress | null;
  setLabProgress: (p: LabRunProgress | null) => void;
  finishLabRun: () => void;

  // Arena
  arenaRuns: LabArenaRun[];
  arenaResultsMap: Record<string, LabArenaResult[]>;
  fetchArenaRuns: (personaId: string) => Promise<void>;
  startArena: (personaId: string, models: ModelTestConfig[], useCaseFilter?: string) => Promise<string | null>;
  cancelArena: (runId: string) => Promise<void>;
  fetchArenaResults: (runId: string) => Promise<void>;
  deleteArenaRun: (runId: string) => Promise<void>;

  // A/B
  abRuns: LabAbRun[];
  abResultsMap: Record<string, LabAbResult[]>;
  fetchAbRuns: (personaId: string) => Promise<void>;
  startAb: (personaId: string, versionAId: string, versionBId: string, models: ModelTestConfig[], useCaseFilter?: string, testInput?: string) => Promise<string | null>;
  cancelAb: (runId: string) => Promise<void>;
  fetchAbResults: (runId: string) => Promise<void>;
  deleteAbRun: (runId: string) => Promise<void>;

  // Matrix
  matrixRuns: LabMatrixRun[];
  matrixResultsMap: Record<string, LabMatrixResult[]>;
  fetchMatrixRuns: (personaId: string) => Promise<void>;
  startMatrix: (personaId: string, instruction: string, models: ModelTestConfig[], useCaseFilter?: string) => Promise<string | null>;
  cancelMatrix: (runId: string) => Promise<void>;
  fetchMatrixResults: (runId: string) => Promise<void>;
  deleteMatrixRun: (runId: string) => Promise<void>;
  acceptDraft: (runId: string) => Promise<void>;

  // Eval
  evalRuns: LabEvalRun[];
  evalResultsMap: Record<string, LabEvalResult[]>;
  fetchEvalRuns: (personaId: string) => Promise<void>;
  startEval: (personaId: string, versionIds: string[], models: ModelTestConfig[], useCaseFilter?: string, testInput?: string) => Promise<string | null>;
  cancelEval: (runId: string) => Promise<void>;
  fetchEvalResults: (runId: string) => Promise<void>;
  deleteEvalRun: (runId: string) => Promise<void>;

  // Versions
  promptVersions: PersonaPromptVersion[];
  fetchVersions: (personaId: string) => Promise<void>;
  tagVersion: (id: string, tag: string) => Promise<void>;
  rollbackVersion: (versionId: string) => Promise<void>;
  healthErrorRate: number | null;
  fetchHealthRate: (personaId: string) => Promise<void>;
}

export const createLabSlice: StateCreator<PersonaStore, [], [], LabSlice> = (set, get) => ({
  // Mode
  labMode: "arena",
  setLabMode: (mode) => set({ labMode: mode }),

  // Shared
  isLabRunning: false,
  labProgress: null,
  setLabProgress: (p) => set({ labProgress: p }),
  finishLabRun: () => {
    clearLabRunSafetyTimeout();
    set({ isLabRunning: false });
    const personaId = get().selectedPersona?.id;
    if (personaId) {
      get().fetchArenaRuns(personaId);
      get().fetchAbRuns(personaId);
      get().fetchMatrixRuns(personaId);
      get().fetchEvalRuns(personaId);
    }
  },

  // Arena
  arenaRuns: [],
  arenaResultsMap: {},
  fetchArenaRuns: async (personaId) => {
    try {
      const runs = await api.labListArenaRuns(personaId);
      set({ arenaRuns: runs });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch arena runs") });
    }
  },
  startArena: async (personaId, models, useCaseFilter) => {
    set({ isLabRunning: true, labProgress: null, error: null });
    scheduleLabRunSafetyTimeout(() => {
      set({ isLabRunning: false, labProgress: null });
    });
    try {
      const run = await api.labStartArena(personaId, models, useCaseFilter);
      return run.id;
    } catch (err) {
      clearLabRunSafetyTimeout();
      set({ error: errMsg(err, "Failed to start arena test"), isLabRunning: false });
      return null;
    }
  },
  cancelArena: async (runId) => {
    try {
      await api.labCancelArena(runId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel arena test") });
    } finally {
      clearLabRunSafetyTimeout();
      set({ isLabRunning: false, labProgress: null });
    }
  },
  fetchArenaResults: async (runId) => {
    try {
      const results = await api.labGetArenaResults(runId);
      set((state) => ({ arenaResultsMap: { ...state.arenaResultsMap, [runId]: results } }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch arena results") });
    }
  },
  deleteArenaRun: async (runId) => {
    try {
      await api.labDeleteArenaRun(runId);
      set((state) => {
        const { [runId]: _, ...rest } = state.arenaResultsMap;
        return { arenaRuns: state.arenaRuns.filter((r) => r.id !== runId), arenaResultsMap: rest };
      });
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete arena run") });
    }
  },

  // A/B
  abRuns: [],
  abResultsMap: {},
  fetchAbRuns: async (personaId) => {
    try {
      const runs = await api.labListAbRuns(personaId);
      set({ abRuns: runs });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch A/B runs") });
    }
  },
  startAb: async (personaId, versionAId, versionBId, models, useCaseFilter, testInput) => {
    set({ isLabRunning: true, labProgress: null, error: null });
    scheduleLabRunSafetyTimeout(() => {
      set({ isLabRunning: false, labProgress: null });
    });
    try {
      const run = await api.labStartAb(personaId, versionAId, versionBId, models, useCaseFilter, testInput);
      return run.id;
    } catch (err) {
      clearLabRunSafetyTimeout();
      set({ error: errMsg(err, "Failed to start A/B test"), isLabRunning: false });
      return null;
    }
  },
  cancelAb: async (runId) => {
    try {
      await api.labCancelAb(runId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel A/B test") });
    } finally {
      clearLabRunSafetyTimeout();
      set({ isLabRunning: false, labProgress: null });
    }
  },
  fetchAbResults: async (runId) => {
    try {
      const results = await api.labGetAbResults(runId);
      set((state) => ({ abResultsMap: { ...state.abResultsMap, [runId]: results } }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch A/B results") });
    }
  },
  deleteAbRun: async (runId) => {
    try {
      await api.labDeleteAbRun(runId);
      set((state) => {
        const { [runId]: _, ...rest } = state.abResultsMap;
        return { abRuns: state.abRuns.filter((r) => r.id !== runId), abResultsMap: rest };
      });
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete A/B run") });
    }
  },

  // Matrix
  matrixRuns: [],
  matrixResultsMap: {},
  fetchMatrixRuns: async (personaId) => {
    try {
      const runs = await api.labListMatrixRuns(personaId);
      set({ matrixRuns: runs });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch matrix runs") });
    }
  },
  startMatrix: async (personaId, instruction, models, useCaseFilter) => {
    set({ isLabRunning: true, labProgress: null, error: null });
    scheduleLabRunSafetyTimeout(() => {
      set({ isLabRunning: false, labProgress: null });
    });
    try {
      const run = await api.labStartMatrix(personaId, instruction, models, useCaseFilter);
      return run.id;
    } catch (err) {
      clearLabRunSafetyTimeout();
      set({ error: errMsg(err, "Failed to start matrix test"), isLabRunning: false });
      return null;
    }
  },
  cancelMatrix: async (runId) => {
    try {
      await api.labCancelMatrix(runId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel matrix test") });
    } finally {
      clearLabRunSafetyTimeout();
      set({ isLabRunning: false, labProgress: null });
    }
  },
  fetchMatrixResults: async (runId) => {
    try {
      const results = await api.labGetMatrixResults(runId);
      set((state) => ({ matrixResultsMap: { ...state.matrixResultsMap, [runId]: results } }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch matrix results") });
    }
  },
  deleteMatrixRun: async (runId) => {
    try {
      await api.labDeleteMatrixRun(runId);
      set((state) => {
        const { [runId]: _, ...rest } = state.matrixResultsMap;
        return { matrixRuns: state.matrixRuns.filter((r) => r.id !== runId), matrixResultsMap: rest };
      });
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete matrix run") });
    }
  },
  acceptDraft: async (runId) => {
    try {
      const persona = await api.labAcceptDraft(runId);
      const personaId = persona.id;
      // Re-select to refresh full PersonaWithDetails (tools, triggers, etc.)
      get().selectPersona(personaId);
      get().fetchMatrixRuns(personaId);
      get().fetchVersions(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to accept draft") });
    }
  },

  // Eval
  evalRuns: [],
  evalResultsMap: {},
  fetchEvalRuns: async (personaId) => {
    try {
      const runs = await api.labListEvalRuns(personaId);
      set({ evalRuns: runs });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch eval runs") });
    }
  },
  startEval: async (personaId, versionIds, models, useCaseFilter, testInput) => {
    set({ isLabRunning: true, labProgress: null, error: null });
    scheduleLabRunSafetyTimeout(() => {
      set({ isLabRunning: false, labProgress: null });
    });
    try {
      const run = await api.labStartEval(personaId, versionIds, models, useCaseFilter, testInput);
      return run.id;
    } catch (err) {
      clearLabRunSafetyTimeout();
      set({ error: errMsg(err, "Failed to start eval test"), isLabRunning: false });
      return null;
    }
  },
  cancelEval: async (runId) => {
    try {
      await api.labCancelEval(runId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel eval test") });
    } finally {
      clearLabRunSafetyTimeout();
      set({ isLabRunning: false, labProgress: null });
    }
  },
  fetchEvalResults: async (runId) => {
    try {
      const results = await api.labGetEvalResults(runId);
      set((state) => ({ evalResultsMap: { ...state.evalResultsMap, [runId]: results } }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch eval results") });
    }
  },
  deleteEvalRun: async (runId) => {
    try {
      await api.labDeleteEvalRun(runId);
      set((state) => {
        const { [runId]: _, ...rest } = state.evalResultsMap;
        return { evalRuns: state.evalRuns.filter((r) => r.id !== runId), evalResultsMap: rest };
      });
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete eval run") });
    }
  },

  // Versions
  promptVersions: [],
  fetchVersions: async (personaId) => {
    try {
      const versions = await api.labGetVersions(personaId);
      set({ promptVersions: versions });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch prompt versions") });
    }
  },
  tagVersion: async (id, tag) => {
    try {
      await api.labTagVersion(id, tag);
      const personaId = get().selectedPersona?.id;
      if (personaId) get().fetchVersions(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to tag version") });
    }
  },
  rollbackVersion: async (versionId) => {
    try {
      await api.labRollbackVersion(versionId);
      const personaId = get().selectedPersona?.id;
      if (personaId) {
        get().fetchVersions(personaId);
        // Re-select to refresh full PersonaWithDetails
        get().selectPersona(personaId);
      }
    } catch (err) {
      set({ error: errMsg(err, "Failed to rollback version") });
    }
  },
  healthErrorRate: null,
  fetchHealthRate: async (personaId) => {
    try {
      const rate = await api.labGetErrorRate(personaId);
      set({ healthErrorRate: rate });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch error rate") });
    }
  },
});
