import type { StateCreator } from "zustand";
import * as Sentry from "@sentry/react";
import type { SystemStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import * as api from "@/api/researchLab/researchLab";
import type {
  ResearchProject, CreateResearchProject, UpdateResearchProject,
  ResearchSource, CreateResearchSource, CreateSourceResult,
  ResearchHypothesis, CreateResearchHypothesis,
  ResearchExperiment, CreateResearchExperiment,
  ResearchFinding, CreateResearchFinding,
  ResearchReport, CreateResearchReport,
  ResearchDashboardStats,
} from "@/api/researchLab/researchLab";

/**
 * Passive list-load failure handler. Research-lab list fetches run on mount,
 * not on user action — a red toast for "list came back empty/unavailable" is
 * noise. Log to console for debugging, capture to Sentry for telemetry, and
 * leave the slice in its empty state. User-initiated mutations
 * (create/update/delete) still surface errors via toastCatch in the calling
 * component, so feedback isn't lost where it matters.
 */
function logPassiveFetchFailure(action: string, err: unknown): void {
  console.warn(`[research-lab] ${action} failed (showing empty state):`, errMsg(err, action), err);
  Sentry.withScope((scope) => {
    scope.setTag("error.action", action);
    scope.setLevel("warning");
    Sentry.captureException(err);
  });
}

export interface ResearchLabSlice {
  // Projects
  researchProjects: ResearchProject[];
  activeResearchProjectId: string | null;
  researchProjectsLoading: boolean;

  fetchResearchProjects: () => Promise<void>;
  createResearchProject: (input: CreateResearchProject) => Promise<ResearchProject>;
  updateResearchProject: (id: string, input: UpdateResearchProject) => Promise<void>;
  deleteResearchProject: (id: string) => Promise<void>;
  setActiveResearchProject: (id: string | null) => void;

  // Sources
  researchSources: ResearchSource[];
  researchSourcesLoading: boolean;
  fetchResearchSources: (projectId: string) => Promise<void>;
  createResearchSource: (input: CreateResearchSource) => Promise<CreateSourceResult>;
  deleteResearchSource: (id: string) => Promise<void>;

  // Hypotheses
  researchHypotheses: ResearchHypothesis[];
  researchHypothesesLoading: boolean;
  fetchResearchHypotheses: (projectId: string) => Promise<void>;
  createResearchHypothesis: (input: CreateResearchHypothesis) => Promise<ResearchHypothesis>;
  deleteResearchHypothesis: (id: string) => Promise<void>;

  // Experiments
  researchExperiments: ResearchExperiment[];
  researchExperimentsLoading: boolean;
  fetchResearchExperiments: (projectId: string) => Promise<void>;
  createResearchExperiment: (input: CreateResearchExperiment) => Promise<ResearchExperiment>;
  deleteResearchExperiment: (id: string) => Promise<void>;

  // Findings
  researchFindings: ResearchFinding[];
  researchFindingsLoading: boolean;
  fetchResearchFindings: (projectId: string) => Promise<void>;
  createResearchFinding: (input: CreateResearchFinding) => Promise<ResearchFinding>;
  deleteResearchFinding: (id: string) => Promise<void>;

  // Reports
  researchReports: ResearchReport[];
  researchReportsLoading: boolean;
  fetchResearchReports: (projectId: string) => Promise<void>;
  createResearchReport: (input: CreateResearchReport) => Promise<ResearchReport>;
  deleteResearchReport: (id: string) => Promise<void>;

  // Dashboard
  researchDashboardStats: ResearchDashboardStats | null;
  fetchResearchDashboardStats: () => Promise<void>;

  // Obsidian sync
  syncToObsidian: (projectId: string) => Promise<number>;
  syncDailyNote: (projectId: string) => Promise<string>;

  // Source ingestion
  updateSourceStatus: (id: string, status: string, knowledgeBaseId?: string) => Promise<void>;
}

/**
 * Six of the resource groups below (projects/sources/hypotheses/experiments/
 * findings/reports) share the exact same fetch-list and create/delete shape:
 * set loading -> await api -> set data + loading:false (or logPassiveFetchFailure
 * on error), and prepend-on-create / filter-on-delete. These two tiny generic
 * helpers collapse that boilerplate; `createResearchSource`'s dedup logic stays
 * hand-written below since it isn't a plain prepend. The `as unknown as
 * Partial<SystemStore>` casts are contained here — callers keep normal typed
 * arguments (list keys of ResearchLabSlice, well-typed api functions).
 */
function makeListFetcher<T, Args extends unknown[]>(
  set: (partial: Partial<SystemStore>) => void,
  actionName: string,
  dataKey: keyof ResearchLabSlice,
  loadingKey: keyof ResearchLabSlice,
  apiCall: (...args: Args) => Promise<T[]>,
) {
  return async (...args: Args) => {
    set({ [loadingKey]: true } as unknown as Partial<SystemStore>);
    try {
      const data = await apiCall(...args);
      set({ [dataKey]: data, [loadingKey]: false } as unknown as Partial<SystemStore>);
    } catch (err) {
      logPassiveFetchFailure(actionName, err);
      set({ [loadingKey]: false } as unknown as Partial<SystemStore>);
    }
  };
}

function makePrepend<T extends { id: string }>(
  set: (updater: (s: SystemStore) => Partial<SystemStore>) => void,
  dataKey: keyof ResearchLabSlice,
) {
  return (item: T) =>
    set((s) => ({
      [dataKey]: [item, ...(s[dataKey as keyof SystemStore] as unknown as T[])],
    } as unknown as Partial<SystemStore>));
}

function makeRemoveById(
  set: (updater: (s: SystemStore) => Partial<SystemStore>) => void,
  dataKey: keyof ResearchLabSlice,
) {
  return (id: string) =>
    set((s) => ({
      [dataKey]: (s[dataKey as keyof SystemStore] as unknown as { id: string }[]).filter((x) => x.id !== id),
    } as unknown as Partial<SystemStore>));
}

export const createResearchLabSlice: StateCreator<SystemStore, [], [], ResearchLabSlice> = (set) => ({
  // -- Projects --
  researchProjects: [],
  activeResearchProjectId: null,
  researchProjectsLoading: false,

  fetchResearchProjects: makeListFetcher(set, "fetchResearchProjects", "researchProjects", "researchProjectsLoading", api.listProjects),

  createResearchProject: async (input) => {
    const project = await api.createProject(input);
    makePrepend<ResearchProject>(set, "researchProjects")(project);
    return project;
  },

  updateResearchProject: async (id, input) => {
    const updated = await api.updateProject(id, input);
    set((s) => ({ researchProjects: s.researchProjects.map((p) => (p.id === id ? updated : p)) }));
  },

  deleteResearchProject: async (id) => {
    await api.deleteProject(id);
    set((s) => ({
      researchProjects: s.researchProjects.filter((p) => p.id !== id),
      activeResearchProjectId: s.activeResearchProjectId === id ? null : s.activeResearchProjectId,
    }));
  },

  setActiveResearchProject: (id) => set({ activeResearchProjectId: id }),

  // -- Sources --
  researchSources: [],
  researchSourcesLoading: false,

  fetchResearchSources: makeListFetcher(set, "fetchResearchSources", "researchSources", "researchSourcesLoading", api.listSources),

  createResearchSource: async (input) => {
    const result = await api.createSource(input);
    // Only prepend genuinely-new sources. On a dedup hit the backend returns an
    // existing row — adding it again would duplicate it in the list (and a
    // re-fetch already has it), so insert it only if it's not already present.
    set((s) => {
      const present = s.researchSources.some((x) => x.id === result.source.id);
      if (result.created || !present) {
        return { researchSources: [result.source, ...s.researchSources.filter((x) => x.id !== result.source.id)] };
      }
      return s;
    });
    return result;
  },

  deleteResearchSource: async (id) => {
    await api.deleteSource(id);
    makeRemoveById(set, "researchSources")(id);
  },

  // -- Hypotheses --
  researchHypotheses: [],
  researchHypothesesLoading: false,

  fetchResearchHypotheses: makeListFetcher(set, "fetchResearchHypotheses", "researchHypotheses", "researchHypothesesLoading", api.listHypotheses),

  createResearchHypothesis: async (input) => {
    const hypothesis = await api.createHypothesis(input);
    makePrepend<ResearchHypothesis>(set, "researchHypotheses")(hypothesis);
    return hypothesis;
  },

  deleteResearchHypothesis: async (id) => {
    await api.deleteHypothesis(id);
    makeRemoveById(set, "researchHypotheses")(id);
  },

  // -- Experiments --
  researchExperiments: [],
  researchExperimentsLoading: false,

  fetchResearchExperiments: makeListFetcher(set, "fetchResearchExperiments", "researchExperiments", "researchExperimentsLoading", api.listExperiments),

  createResearchExperiment: async (input) => {
    const experiment = await api.createExperiment(input);
    makePrepend<ResearchExperiment>(set, "researchExperiments")(experiment);
    return experiment;
  },

  deleteResearchExperiment: async (id) => {
    await api.deleteExperiment(id);
    makeRemoveById(set, "researchExperiments")(id);
  },

  // -- Findings --
  researchFindings: [],
  researchFindingsLoading: false,

  fetchResearchFindings: makeListFetcher(set, "fetchResearchFindings", "researchFindings", "researchFindingsLoading", api.listFindings),

  createResearchFinding: async (input) => {
    const finding = await api.createFinding(input);
    makePrepend<ResearchFinding>(set, "researchFindings")(finding);
    return finding;
  },

  deleteResearchFinding: async (id) => {
    await api.deleteFinding(id);
    makeRemoveById(set, "researchFindings")(id);
  },

  // -- Reports --
  researchReports: [],
  researchReportsLoading: false,

  fetchResearchReports: makeListFetcher(set, "fetchResearchReports", "researchReports", "researchReportsLoading", api.listReports),

  createResearchReport: async (input) => {
    const report = await api.createReport(input);
    makePrepend<ResearchReport>(set, "researchReports")(report);
    return report;
  },

  deleteResearchReport: async (id) => {
    await api.deleteReport(id);
    makeRemoveById(set, "researchReports")(id);
  },

  // -- Dashboard --
  researchDashboardStats: null,

  fetchResearchDashboardStats: async () => {
    try {
      const researchDashboardStats = await api.getDashboardStats();
      set({ researchDashboardStats });
    } catch (err) {
      logPassiveFetchFailure("fetchResearchDashboardStats", err);
    }
  },

  // -- Obsidian sync --
  syncToObsidian: async (projectId) => {
    return api.syncToObsidian(projectId);
  },

  syncDailyNote: async (projectId) => {
    return api.syncDailyNote(projectId);
  },

  // -- Source ingestion --
  updateSourceStatus: async (id, status, knowledgeBaseId) => {
    await api.updateSourceStatus(id, status, knowledgeBaseId);
    set((s) => ({
      researchSources: s.researchSources.map((src) =>
        src.id === id ? { ...src, status, knowledgeBaseId: knowledgeBaseId ?? src.knowledgeBaseId } : src
      ),
    }));
  },
});
