import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";
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

const logger = createLogger("lab-slice");

const arenaLifecycle = createRunLifecycle('isArenaRunning', 'arenaProgress');
const matrixLifecycle = createRunLifecycle('isMatrixRunning', 'matrixProgress');
// Legacy alias — panels that still check isLabRunning will see true if ANY mode is running
const labLifecycle = createRunLifecycle('isLabRunning', 'labProgress');

const RUN_HISTORY_LIMIT = 20;
const MAX_CACHED_RUN_RESULTS = 10;

export type LabMode = "arena" | "ab" | "matrix" | "eval" | "versions" | "breed" | "evolve" | "regression";

// -- Baseline Pinning (localStorage persistence) ----------------------

const BASELINE_STORAGE_KEY = 'dac-lab-baselines';

export interface BaselinePin {
  versionId: string;
  versionNumber: number;
  runId: string;
  pinnedAt: string;
}

function loadBaselines(): Record<string, BaselinePin> {
  try {
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveBaselines(baselines: Record<string, BaselinePin>) {
  localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselines));
}

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

const TERMINAL_STATUSES: Set<LabRunStatus> = new Set(["completed", "failed", "cancelled"]);

function createLabCrud<TRun extends { id: string; status: LabRunStatus }, TResult>(
  runsKey: keyof AgentStore,
  resultsMapKey: keyof AgentStore,
  label: string,
  calls: LabCrudApi<TRun, TResult>,
  set: StoreSetter,
  getState: () => AgentStore,
  lifecycle?: ReturnType<typeof createRunLifecycle>,
): LabCrudActions<TRun> {
  const lc = lifecycle ?? labLifecycle;
  return {
    fetchRuns: async (personaId) => {
      try {
        const runs = await calls.list(personaId, RUN_HISTORY_LIMIT);
        set({ [runsKey]: runs } as Partial<AgentStore>);
      } catch (err) {
        reportError(err, `Failed to fetch ${label} runs`, set, { action: `lab.${label}.fetchRuns` });
      }
    },
    cancelRun: async (runId) => {
      try {
        await calls.cancel(runId);
      } catch (err) {
        reportError(err, `Failed to cancel ${label} test`, set, { action: `lab.${label}.cancelRun` });
      } finally {
        labLifecycle.markCancelled(set);
      }
    },
    fetchResults: async (runId) => {
      try {
        // Skip fetch if results are already cached and the run is in a terminal state
        const state = getState();
        const cachedResults = (state[resultsMapKey] as unknown as Record<string, unknown[]>)[runId];
        if (cachedResults) {
          const runs = state[runsKey] as unknown as TRun[];
          const run = runs.find((r) => r.id === runId);
          if (run && TERMINAL_STATUSES.has(run.status)) return;
        }
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
        reportError(err, `Failed to fetch ${label} results`, set, { action: `lab.${label}.fetchResults` });
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
        reportError(err, `Failed to delete ${label} run`, set, { action: `lab.${label}.deleteRun` });
      }
    },
    wrapStart: async (fn, ...args) => {
      // First arg of every lab start API is the personaId. Track it on the
      // running set so the sidebar orbit dots can show one orange dot per
      // persona with an active lab run.
      const personaId = typeof args[0] === 'string' ? (args[0] as string) : null;
      lc.markStarted(set);
      if (personaId) {
        set((state) => {
          const next = Array.from(new Set([...(state as unknown as { labRunningPersonaIds?: string[] }).labRunningPersonaIds ?? [], personaId]));
          return { labRunningPersonaIds: next } as Partial<AgentStore>;
        });
      }
      try {
        const run = await fn(...args);
        return run.id;
      } catch (err) {
        lc.markFailed(set);
        if (personaId) {
          set((state) => {
            const ids = (state as unknown as { labRunningPersonaIds?: string[] }).labRunningPersonaIds ?? [];
            return { labRunningPersonaIds: ids.filter((id) => id !== personaId) } as Partial<AgentStore>;
          });
        }
        reportError(err, `Failed to start ${label} test`, set, { action: `lab.${label}.startRun` });
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

  // Per-mode running state (allows concurrent runs)
  isArenaRunning: boolean;
  arenaProgress: LabRunProgress | null;
  isMatrixRunning: boolean;
  matrixProgress: LabRunProgress | null;
  // Legacy shared state (true if ANY mode is running)
  isLabRunning: boolean;
  labProgress: LabRunProgress | null;
  setLabProgress: (p: LabRunProgress | null) => void;
  finishLabRun: (mode?: LabMode) => void;
  /** personaIds with at least one active lab run. Feeds sidebar orbit dots. */
  labRunningPersonaIds: string[];

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

  // Active progress hydration (restores progress after page refresh)
  hydrateActiveProgress: (personaId: string) => Promise<void>;

  // Baseline Pinning (regression testing)
  baselinePin: BaselinePin | null;
  pinBaseline: (personaId: string, versionId: string, versionNumber: number, runId: string) => void;
  unpinBaseline: (personaId: string) => void;
  loadBaseline: (personaId: string) => void;
}

// -- Slice Creator ------------------------------------------------

export const createLabSlice: StateCreator<AgentStore, [], [], LabSlice> = (set, get) => {
  // Instantiate CRUD factories -- one line per mode
  const arena  = createLabCrud<LabArenaRun, LabArenaResult>('arenaRuns', 'arenaResultsMap', 'arena', { list: api.labListArenaRuns, results: api.labGetArenaResults, remove: api.labDeleteArenaRun, cancel: api.labCancelArena }, set, get, arenaLifecycle);
  const ab     = createLabCrud<LabAbRun, LabAbResult>('abRuns', 'abResultsMap', 'A/B', { list: api.labListAbRuns, results: api.labGetAbResults, remove: api.labDeleteAbRun, cancel: api.labCancelAb }, set, get, matrixLifecycle);
  const matrix = createLabCrud<LabMatrixRun, LabMatrixResult>('matrixRuns', 'matrixResultsMap', 'matrix', { list: api.labListMatrixRuns, results: api.labGetMatrixResults, remove: api.labDeleteMatrixRun, cancel: api.labCancelMatrix }, set, get, matrixLifecycle);
  const eval_  = createLabCrud<LabEvalRun, LabEvalResult>('evalRuns', 'evalResultsMap', 'eval', { list: api.labListEvalRuns, results: api.labGetEvalResults, remove: api.labDeleteEvalRun, cancel: api.labCancelEval }, set, get, matrixLifecycle);

  return {
    // Mode
    labMode: "arena",
    setLabMode: (mode) => set({ labMode: mode }),

    // A/B pre-selection
    abPreselectedA: null,
    abPreselectedB: null,
    setAbPreselect: (a, b) => set({ abPreselectedA: a, abPreselectedB: b }),

    // Per-mode running state
    isArenaRunning: false,
    arenaProgress: null,
    isMatrixRunning: false,
    matrixProgress: null,
    // Legacy shared
    isLabRunning: false,
    labProgress: null,
    // Per-persona lab activity (drives sidebar orbit dots)
    labRunningPersonaIds: [],
    setLabProgress: (p) => set({ labProgress: p }),
    finishLabRun: (mode) => {
      // Finish the mode-specific lifecycle
      if (mode === 'arena') arenaLifecycle.markFinished(set);
      else if (mode === 'matrix' || mode === 'ab' || mode === 'eval') matrixLifecycle.markFinished(set);
      labLifecycle.markFinished(set);
      const personaId = get().selectedPersona?.id;
      // Drop this persona from the running set — the lab run ended.
      if (personaId) {
        set((state) => ({
          labRunningPersonaIds: state.labRunningPersonaIds.filter((id) => id !== personaId),
        }));
      }
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
        // All callers (useLabEvents) provide mode — log if we ever hit this
        logger.warn("finishLabRun called without mode; refreshing active labMode only", { labMode: get().labMode });
        const fallbackMode = get().labMode;
        if (fetchByMode[fallbackMode]) {
          fetchByMode[fallbackMode]();
        }
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
        reportError(err, "Failed to accept draft", set, { action: "lab.acceptDraft" });
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
        reportError(err, "Failed to fetch user ratings", set, { action: "lab.fetchUserRatings" });
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
        reportError(err, "Failed to rate result", set, { action: "lab.rateResult" });
      }
    },

    // Versions
    promptVersions: [],
    fetchVersions: async (personaId) => {
      try {
        const versions = await api.labGetVersions(personaId);
        set({ promptVersions: versions });
      } catch (err) {
        reportError(err, "Failed to fetch prompt versions", set, { action: "lab.fetchVersions" });
      }
    },
    tagVersion: async (id, tag) => {
      try {
        await api.labTagVersion(id, tag);
        const personaId = get().selectedPersona?.id;
        if (personaId) get().fetchVersions(personaId);
      } catch (err) {
        reportError(err, "Failed to tag version", set, { action: "lab.tagVersion" });
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
        reportError(err, "Failed to rollback version", set, { action: "lab.rollbackVersion" });
      }
    },
    healthErrorRate: null,
    fetchHealthRate: async (personaId) => {
      try {
        const rate = await api.labGetErrorRate(personaId);
        set({ healthErrorRate: rate });
      } catch (err) {
        reportError(err, "Failed to fetch error rate", set, { action: "lab.fetchHealthRate" });
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
        reportError(err, "Failed to generate prompt improvement", set, { action: "lab.improvePrompt" });
        return null;
      }
    },

    // Active progress hydration — restores all active run progress after page refresh
    hydrateActiveProgress: async (personaId) => {
      try {
        const entries = await api.labGetActiveProgress(personaId);
        if (!entries || entries.length === 0) return;
        // Apply each active run's progress to the store
        for (const entry of entries) {
          const mode = entry.mode as LabMode;
          const progress = entry.progress as Record<string, unknown>;
          const mapped: LabRunProgress = {
            runId: entry.runId,
            mode,
            phase: (progress.phase as string) ?? "running",
            current: progress.current as number | undefined,
            total: progress.total as number | undefined,
            scenariosCount: progress.scenariosCount as number | undefined,
            modelId: progress.modelId as string | undefined,
            scenarioName: progress.scenarioName as string | undefined,
          };
          // Set the shared labProgress to the most recent entry (first in array)
          if (entry === entries[0]) {
            set({ labProgress: mapped, isLabRunning: true });
          }
          // Set mode-specific running state
          if (mode === "arena") {
            arenaLifecycle.markStarted(set);
            set({ arenaProgress: mapped });
          } else if (mode === "matrix" || mode === "ab" || mode === "eval") {
            matrixLifecycle.markStarted(set);
            set({ matrixProgress: mapped });
          }
        }
      } catch (err) {
        reportError(err, "Failed to hydrate active lab progress", set, { action: "lab.hydrateActiveProgress" });
      }
    },

    // Baseline Pinning
    baselinePin: null,
    pinBaseline: (personaId, versionId, versionNumber, runId) => {
      const pin: BaselinePin = { versionId, versionNumber, runId, pinnedAt: new Date().toISOString() };
      const all = loadBaselines();
      all[personaId] = pin;
      saveBaselines(all);
      set({ baselinePin: pin });
      logger.info(`Pinned baseline for ${personaId}: v${versionNumber} (run ${runId})`);
    },
    unpinBaseline: (personaId) => {
      const all = loadBaselines();
      delete all[personaId];
      saveBaselines(all);
      set({ baselinePin: null });
      logger.info(`Unpinned baseline for ${personaId}`);
    },
    loadBaseline: (personaId) => {
      const all = loadBaselines();
      set({ baselinePin: all[personaId] ?? null });
    },
  };
};
