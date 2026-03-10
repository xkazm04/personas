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
import * as api from "@/api/lab";
import { createRunLifecycle } from "./runLifecycle";

const labLifecycle = createRunLifecycle('isLabRunning', 'labProgress');

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

// â”€â”€ CRUD Factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Eliminates duplicated fetchRuns/cancel/fetchResults/deleteRun/startRun
// patterns across arena, ab, matrix, and eval modes.

type StoreSetter = Parameters<StateCreator<PersonaStore, [], [], LabSlice>>[0];

interface LabCrudApi<TRun, TResult> {
  list: (personaId: string) => Promise<TRun[]>;
  results: (runId: string) => Promise<TResult[]>;
  remove: (id: string) => Promise<unknown>;
  cancel: (id: string) => Promise<unknown>;
}

interface LabCrudActions<TRun> {
  fetchRuns: (personaId: string) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  fetchResults: (runId: string) => Promise<void>;
  deleteRun: (runId: string) => Promise<void>;
  /** Wrap any start API call with lifecycle management. */
  wrapStart: <T extends unknown[]>(fn: (...args: T) => Promise<TRun>, ...args: T) => Promise<string | null>;
}

function createLabCrud<TRun extends { id: string }, TResult>(
  runsKey: keyof PersonaStore,
  resultsMapKey: keyof PersonaStore,
  label: string,
  calls: LabCrudApi<TRun, TResult>,
  set: StoreSetter,
): LabCrudActions<TRun> {
  return {
    fetchRuns: async (personaId) => {
      try {
        const runs = await calls.list(personaId);
        set({ [runsKey]: runs } as Partial<PersonaStore>);
      } catch (err) {
        set({ error: errMsg(err, `Failed to fetch ${label} runs`) });
      }
    },
    cancelRun: async (runId) => {
      try {
        await calls.cancel(runId);
      } catch (err) {
        set({ error: errMsg(err, `Failed to cancel ${label} test`) });
      } finally {
        labLifecycle.markCancelled(set);
      }
    },
    fetchResults: async (runId) => {
      try {
        const results = await calls.results(runId);
        set((state) => ({
          [resultsMapKey]: { ...(state[resultsMapKey] as unknown as Record<string, unknown[]>), [runId]: results },
        } as Partial<PersonaStore>));
      } catch (err) {
        set({ error: errMsg(err, `Failed to fetch ${label} results`) });
      }
    },
    deleteRun: async (runId) => {
      try {
        await calls.remove(runId);
        set((state) => {
          const resultsMap = state[resultsMapKey] as unknown as Record<string, unknown[]>;
          const { [runId]: _, ...rest } = resultsMap;
          const runs = state[runsKey] as unknown as TRun[];
          return {
            [runsKey]: runs.filter((r) => r.id !== runId),
            [resultsMapKey]: rest,
          } as Partial<PersonaStore>;
        });
      } catch (err) {
        set({ error: errMsg(err, `Failed to delete ${label} run`) });
      }
    },
    wrapStart: async (fn, ...args) => {
      labLifecycle.markStarted(set);
      try {
        const run = await fn(...args);
        return run.id;
      } catch (err) {
        labLifecycle.markFailed(set);
        set({ error: errMsg(err, `Failed to start ${label} test`) });
        return null;
      }
    },
  };
}

// â”€â”€ Slice Interface â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface LabSlice {
  // Mode
  labMode: LabMode;
  setLabMode: (mode: LabMode) => void;

  // Shared running state
  isLabRunning: boolean;
  labProgress: LabRunProgress | null;
  setLabProgress: (p: LabRunProgress | null) => void;
  finishLabRun: (mode?: LabMode) => void;

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

// â”€â”€ Slice Creator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const createLabSlice: StateCreator<PersonaStore, [], [], LabSlice> = (set, get) => {
  // Instantiate CRUD factories â€” one line per mode
  const arena  = createLabCrud<LabArenaRun, LabArenaResult>('arenaRuns', 'arenaResultsMap', 'arena', { list: api.labListArenaRuns, results: api.labGetArenaResults, remove: api.labDeleteArenaRun, cancel: api.labCancelArena }, set);
  const ab     = createLabCrud<LabAbRun, LabAbResult>('abRuns', 'abResultsMap', 'A/B', { list: api.labListAbRuns, results: api.labGetAbResults, remove: api.labDeleteAbRun, cancel: api.labCancelAb }, set);
  const matrix = createLabCrud<LabMatrixRun, LabMatrixResult>('matrixRuns', 'matrixResultsMap', 'matrix', { list: api.labListMatrixRuns, results: api.labGetMatrixResults, remove: api.labDeleteMatrixRun, cancel: api.labCancelMatrix }, set);
  const eval_  = createLabCrud<LabEvalRun, LabEvalResult>('evalRuns', 'evalResultsMap', 'eval', { list: api.labListEvalRuns, results: api.labGetEvalResults, remove: api.labDeleteEvalRun, cancel: api.labCancelEval }, set);

  return {
    // Mode
    labMode: "arena",
    setLabMode: (mode) => set({ labMode: mode }),

    // Shared
    isLabRunning: false,
    labProgress: null,
    setLabProgress: (p) => set({ labProgress: p }),
    finishLabRun: (mode) => {
      labLifecycle.markFinished(set);
      const personaId = get().selectedPersona?.id;
      if (!personaId) return;
      const fetchByMode: Record<string, () => Promise<void>> = {
        arena: () => arena.fetchRuns(personaId),
        ab: () => ab.fetchRuns(personaId),
        matrix: () => matrix.fetchRuns(personaId),
        eval: () => eval_.fetchRuns(personaId),
      };
      if (mode && fetchByMode[mode]) {
        fetchByMode[mode]();
      } else {
        // Fallback: refresh all if mode unknown
        arena.fetchRuns(personaId);
        ab.fetchRuns(personaId);
        matrix.fetchRuns(personaId);
        eval_.fetchRuns(personaId);
      }
    },

    // Arena
    arenaRuns: [],
    arenaResultsMap: {},
    fetchArenaRuns: arena.fetchRuns,
    startArena: (personaId, models, useCaseFilter) =>
      arena.wrapStart(api.labStartArena, personaId, models, useCaseFilter),
    cancelArena: arena.cancelRun,
    fetchArenaResults: arena.fetchResults,
    deleteArenaRun: arena.deleteRun,

    // A/B
    abRuns: [],
    abResultsMap: {},
    fetchAbRuns: ab.fetchRuns,
    startAb: (personaId, versionAId, versionBId, models, useCaseFilter, testInput) =>
      ab.wrapStart(api.labStartAb, personaId, versionAId, versionBId, models, useCaseFilter, testInput),
    cancelAb: ab.cancelRun,
    fetchAbResults: ab.fetchResults,
    deleteAbRun: ab.deleteRun,

    // Matrix
    matrixRuns: [],
    matrixResultsMap: {},
    fetchMatrixRuns: matrix.fetchRuns,
    startMatrix: (personaId, instruction, models, useCaseFilter) =>
      matrix.wrapStart(api.labStartMatrix, personaId, instruction, models, useCaseFilter),
    cancelMatrix: matrix.cancelRun,
    fetchMatrixResults: matrix.fetchResults,
    deleteMatrixRun: matrix.deleteRun,
    acceptDraft: async (runId) => {
      try {
        const persona = await api.labAcceptDraft(runId);
        const personaId = persona.id;
        get().selectPersona(personaId);
        matrix.fetchRuns(personaId);
        get().fetchVersions(personaId);
      } catch (err) {
        set({ error: errMsg(err, "Failed to accept draft") });
      }
    },

    // Eval
    evalRuns: [],
    evalResultsMap: {},
    fetchEvalRuns: eval_.fetchRuns,
    startEval: (personaId, versionIds, models, useCaseFilter, testInput) =>
      eval_.wrapStart(api.labStartEval, personaId, versionIds, models, useCaseFilter, testInput),
    cancelEval: eval_.cancelRun,
    fetchEvalResults: eval_.fetchResults,
    deleteEvalRun: eval_.deleteRun,

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
  };
};
