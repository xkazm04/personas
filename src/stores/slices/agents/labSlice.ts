import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { LabArenaRun } from "@/lib/bindings/LabArenaRun";
import type { LabArenaResult } from "@/lib/bindings/LabArenaResult";
import type { LabAbRun } from "@/lib/bindings/LabAbRun";
import type { LabAbResult } from "@/lib/bindings/LabAbResult";
import type { LabMatrixRun } from "@/lib/bindings/LabMatrixRun";
import type { LabMatrixResult } from "@/lib/bindings/LabMatrixResult";
import type { LabEvalRun } from "@/lib/bindings/LabEvalRun";
import type { LabEvalResult } from "@/lib/bindings/LabEvalResult";
import type { LabUserRating } from "@/lib/bindings/LabUserRating";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { LabRunStatus } from "@/lib/bindings/LabRunStatus";
import type { ModelTestConfig } from "@/api/agents/tests";
import * as api from "@/api/agents/lab";
import { createRunLifecycle } from "./runLifecycle";

const labLifecycle = createRunLifecycle('isLabRunning', 'labProgress');

const RUN_HISTORY_LIMIT = 20;
const MAX_CACHED_RUN_RESULTS = 10;

export type LabMode = "arena" | "ab" | "matrix" | "eval" | "versions" | "breed" | "evolve";

export interface LabRunProgress {
  runId?: string;
  mode: LabMode;
  phase: string;
  scenariosCount?: number;
  current?: number;
  total?: number;
  modelId?: string;
  scenarioName?: string;
  status?: LabRunStatus;
  scores?: { tool_accuracy?: number; output_quality?: number; protocol_compliance?: number };
  summary?: Record<string, unknown>;
  error?: string;
  elapsedMs?: number;
}

// -- CRUD Factory -------------------------------------------------
// Eliminates duplicated fetchRuns/cancel/fetchResults/deleteRun/startRun
// patterns across arena, ab, matrix, and eval modes.

type StoreSetter = Parameters<StateCreator<AgentStore, [], [], LabSlice>>[0];

interface LabCrudApi<TRun, TResult> {
  list: (personaId: string, limit?: number) => Promise<TRun[]>;
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
  runsKey: keyof AgentStore,
  resultsMapKey: keyof AgentStore,
  label: string,
  calls: LabCrudApi<TRun, TResult>,
  set: StoreSetter,
): LabCrudActions<TRun> {
  return {
    fetchRuns: async (personaId) => {
      try {
        const runs = await calls.list(personaId, RUN_HISTORY_LIMIT);
        set({ [runsKey]: runs } as Partial<AgentStore>);
      } catch (err) {
        reportError(err, `Failed to fetch ${label} runs`, set);
      }
    },
    cancelRun: async (runId) => {
      try {
        await calls.cancel(runId);
      } catch (err) {
        reportError(err, `Failed to cancel ${label} test`, set);
      } finally {
        labLifecycle.markCancelled(set);
      }
    },
    fetchResults: async (runId) => {
      try {
        const results = await calls.results(runId);
        set((state) => {
          const existing = state[resultsMapKey] as unknown as Record<string, unknown[]>;
          const updated = { ...existing, [runId]: results };
          // Evict oldest cached results when exceeding limit
          const keys = Object.keys(updated);
          if (keys.length > MAX_CACHED_RUN_RESULTS) {
            const toEvict = keys.slice(0, keys.length - MAX_CACHED_RUN_RESULTS);
            for (const k of toEvict) {
              if (k !== runId) delete updated[k];
            }
          }
          return { [resultsMapKey]: updated } as Partial<AgentStore>;
        });
      } catch (err) {
        reportError(err, `Failed to fetch ${label} results`, set);
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
          } as Partial<AgentStore>;
        });
      } catch (err) {
        reportError(err, `Failed to delete ${label} run`, set);
      }
    },
    wrapStart: async (fn, ...args) => {
      labLifecycle.markStarted(set);
      try {
        const run = await fn(...args);
        return run.id;
      } catch (err) {
        labLifecycle.markFailed(set);
        reportError(err, `Failed to start ${label} test`, set);
        return null;
      }
    },
  };
}

// -- Slice Interface ----------------------------------------------

export interface LabSlice {
  // Mode
  labMode: LabMode;
  setLabMode: (mode: LabMode) => void;

  // A/B pre-selection (for deep-linking from compare views)
  abPreselectedA: string | null;
  abPreselectedB: string | null;
  setAbPreselect: (a: string | null, b: string | null) => void;

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

  // User Ratings
  userRatings: Record<string, LabUserRating[]>;
  fetchUserRatings: (runId: string) => Promise<void>;
  rateResult: (runId: string, resultId: string | null, scenarioName: string, rating: number, feedback?: string) => Promise<void>;

  // Versions
  promptVersions: PersonaPromptVersion[];
  fetchVersions: (personaId: string) => Promise<void>;
  tagVersion: (id: string, tag: string) => Promise<void>;
  rollbackVersion: (versionId: string) => Promise<void>;
  healthErrorRate: number | null;
  fetchHealthRate: (personaId: string) => Promise<void>;

  // Prompt Improvement Engine
  improvePrompt: (personaId: string, runId: string, mode: string) => Promise<string | null>;
}

// -- Slice Creator ------------------------------------------------

export const createLabSlice: StateCreator<AgentStore, [], [], LabSlice> = (set, get) => {
  // Instantiate CRUD factories -- one line per mode
  const arena  = createLabCrud<LabArenaRun, LabArenaResult>('arenaRuns', 'arenaResultsMap', 'arena', { list: api.labListArenaRuns, results: api.labGetArenaResults, remove: api.labDeleteArenaRun, cancel: api.labCancelArena }, set);
  const ab     = createLabCrud<LabAbRun, LabAbResult>('abRuns', 'abResultsMap', 'A/B', { list: api.labListAbRuns, results: api.labGetAbResults, remove: api.labDeleteAbRun, cancel: api.labCancelAb }, set);
  const matrix = createLabCrud<LabMatrixRun, LabMatrixResult>('matrixRuns', 'matrixResultsMap', 'matrix', { list: api.labListMatrixRuns, results: api.labGetMatrixResults, remove: api.labDeleteMatrixRun, cancel: api.labCancelMatrix }, set);
  const eval_  = createLabCrud<LabEvalRun, LabEvalResult>('evalRuns', 'evalResultsMap', 'eval', { list: api.labListEvalRuns, results: api.labGetEvalResults, remove: api.labDeleteEvalRun, cancel: api.labCancelEval }, set);

  return {
    // Mode
    labMode: "arena",
    setLabMode: (mode) => set({ labMode: mode }),

    // A/B pre-selection
    abPreselectedA: null,
    abPreselectedB: null,
    setAbPreselect: (a, b) => set({ abPreselectedA: a, abPreselectedB: b }),

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
        reportError(err, "Failed to accept draft", set);
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

    // User Ratings
    userRatings: {},
    fetchUserRatings: async (runId) => {
      try {
        const ratings = await api.labGetRatings(runId);
        set((state) => ({
          userRatings: { ...state.userRatings, [runId]: ratings },
        }));
      } catch (err) {
        reportError(err, "Failed to fetch user ratings", set);
      }
    },
    rateResult: async (runId, resultId, scenarioName, rating, feedback) => {
      try {
        const created = await api.labRateResult(runId, resultId, scenarioName, rating, feedback);
        set((state) => {
          const existing = state.userRatings[runId] ?? [];
          // Replace existing rating for same scenario+result, or add new
          const filtered = existing.filter(
            (r) => !(r.scenarioName === scenarioName && r.resultId === resultId),
          );
          return {
            userRatings: { ...state.userRatings, [runId]: [...filtered, created] },
          };
        });
      } catch (err) {
        reportError(err, "Failed to rate result", set);
      }
    },

    // Versions
    promptVersions: [],
    fetchVersions: async (personaId) => {
      try {
        const versions = await api.labGetVersions(personaId);
        set({ promptVersions: versions });
      } catch (err) {
        reportError(err, "Failed to fetch prompt versions", set);
      }
    },
    tagVersion: async (id, tag) => {
      try {
        await api.labTagVersion(id, tag);
        const personaId = get().selectedPersona?.id;
        if (personaId) get().fetchVersions(personaId);
      } catch (err) {
        reportError(err, "Failed to tag version", set);
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
        reportError(err, "Failed to rollback version", set);
      }
    },
    healthErrorRate: null,
    fetchHealthRate: async (personaId) => {
      try {
        const rate = await api.labGetErrorRate(personaId);
        set({ healthErrorRate: rate });
      } catch (err) {
        reportError(err, "Failed to fetch error rate", set);
      }
    },

    // Prompt Improvement Engine
    improvePrompt: async (personaId, runId, mode) => {
      try {
        const version = await api.labImprovePrompt(personaId, runId, mode);
        // Refresh versions list to include the new one
        get().fetchVersions(personaId);
        return version.id;
      } catch (err) {
        reportError(err, "Failed to generate prompt improvement", set);
        return null;
      }
    },
  };
};
