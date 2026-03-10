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
<<<<<<< HEAD
import * as api from "@/api/lab";
import { createRunLifecycle } from "./runLifecycle";

const labLifecycle = createRunLifecycle('isLabRunning', 'labProgress');
=======
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
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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

<<<<<<< HEAD
// ── CRUD Factory ─────────────────────────────────────────────────
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

// ── Slice Interface ──────────────────────────────────────────────

=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
export interface LabSlice {
  // Mode
  labMode: LabMode;
  setLabMode: (mode: LabMode) => void;

  // Shared running state
  isLabRunning: boolean;
  labProgress: LabRunProgress | null;
  setLabProgress: (p: LabRunProgress | null) => void;
<<<<<<< HEAD
  finishLabRun: (mode?: LabMode) => void;
=======
  finishLabRun: () => void;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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

<<<<<<< HEAD
// ── Slice Creator ────────────────────────────────────────────────

export const createLabSlice: StateCreator<PersonaStore, [], [], LabSlice> = (set, get) => {
  // Instantiate CRUD factories — one line per mode
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
=======
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
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
