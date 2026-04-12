import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import * as api from "@/api/researchLab/researchLab";
import type {
  ResearchProject, CreateResearchProject, UpdateResearchProject,
  ResearchSource, CreateResearchSource,
  ResearchHypothesis, CreateResearchHypothesis,
  ResearchExperiment, CreateResearchExperiment,
  ResearchFinding, CreateResearchFinding,
  ResearchReport, CreateResearchReport,
  ResearchDashboardStats,
} from "@/api/researchLab/researchLab";

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
  createResearchSource: (input: CreateResearchSource) => Promise<ResearchSource>;
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

export const createResearchLabSlice: StateCreator<SystemStore, [], [], ResearchLabSlice> = (set) => ({
  // -- Projects --
  researchProjects: [],
  activeResearchProjectId: null,
  researchProjectsLoading: false,

  fetchResearchProjects: async () => {
    set({ researchProjectsLoading: true });
    try {
      const researchProjects = await api.listProjects();
      set({ researchProjects, researchProjectsLoading: false });
    } catch (err) {
      reportError(err, "Failed to fetch research projects", set, { stateUpdates: { researchProjectsLoading: false } });
    }
  },

  createResearchProject: async (input) => {
    const project = await api.createProject(input);
    set((s) => ({ researchProjects: [project, ...s.researchProjects] }));
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

  fetchResearchSources: async (projectId) => {
    set({ researchSourcesLoading: true });
    try {
      const researchSources = await api.listSources(projectId);
      set({ researchSources, researchSourcesLoading: false });
    } catch (err) {
      reportError(err, "Failed to fetch research sources", set, { stateUpdates: { researchSourcesLoading: false } });
    }
  },

  createResearchSource: async (input) => {
    const source = await api.createSource(input);
    set((s) => ({ researchSources: [source, ...s.researchSources] }));
    return source;
  },

  deleteResearchSource: async (id) => {
    await api.deleteSource(id);
    set((s) => ({ researchSources: s.researchSources.filter((s2) => s2.id !== id) }));
  },

  // -- Hypotheses --
  researchHypotheses: [],
  researchHypothesesLoading: false,

  fetchResearchHypotheses: async (projectId) => {
    set({ researchHypothesesLoading: true });
    try {
      const researchHypotheses = await api.listHypotheses(projectId);
      set({ researchHypotheses, researchHypothesesLoading: false });
    } catch (err) {
      reportError(err, "Failed to fetch hypotheses", set, { stateUpdates: { researchHypothesesLoading: false } });
    }
  },

  createResearchHypothesis: async (input) => {
    const hypothesis = await api.createHypothesis(input);
    set((s) => ({ researchHypotheses: [hypothesis, ...s.researchHypotheses] }));
    return hypothesis;
  },

  deleteResearchHypothesis: async (id) => {
    await api.deleteHypothesis(id);
    set((s) => ({ researchHypotheses: s.researchHypotheses.filter((h) => h.id !== id) }));
  },

  // -- Experiments --
  researchExperiments: [],
  researchExperimentsLoading: false,

  fetchResearchExperiments: async (projectId) => {
    set({ researchExperimentsLoading: true });
    try {
      const researchExperiments = await api.listExperiments(projectId);
      set({ researchExperiments, researchExperimentsLoading: false });
    } catch (err) {
      reportError(err, "Failed to fetch experiments", set, { stateUpdates: { researchExperimentsLoading: false } });
    }
  },

  createResearchExperiment: async (input) => {
    const experiment = await api.createExperiment(input);
    set((s) => ({ researchExperiments: [experiment, ...s.researchExperiments] }));
    return experiment;
  },

  deleteResearchExperiment: async (id) => {
    await api.deleteExperiment(id);
    set((s) => ({ researchExperiments: s.researchExperiments.filter((e) => e.id !== id) }));
  },

  // -- Findings --
  researchFindings: [],
  researchFindingsLoading: false,

  fetchResearchFindings: async (projectId) => {
    set({ researchFindingsLoading: true });
    try {
      const researchFindings = await api.listFindings(projectId);
      set({ researchFindings, researchFindingsLoading: false });
    } catch (err) {
      reportError(err, "Failed to fetch findings", set, { stateUpdates: { researchFindingsLoading: false } });
    }
  },

  createResearchFinding: async (input) => {
    const finding = await api.createFinding(input);
    set((s) => ({ researchFindings: [finding, ...s.researchFindings] }));
    return finding;
  },

  deleteResearchFinding: async (id) => {
    await api.deleteFinding(id);
    set((s) => ({ researchFindings: s.researchFindings.filter((f) => f.id !== id) }));
  },

  // -- Reports --
  researchReports: [],
  researchReportsLoading: false,

  fetchResearchReports: async (projectId) => {
    set({ researchReportsLoading: true });
    try {
      const researchReports = await api.listReports(projectId);
      set({ researchReports, researchReportsLoading: false });
    } catch (err) {
      reportError(err, "Failed to fetch reports", set, { stateUpdates: { researchReportsLoading: false } });
    }
  },

  createResearchReport: async (input) => {
    const report = await api.createReport(input);
    set((s) => ({ researchReports: [report, ...s.researchReports] }));
    return report;
  },

  deleteResearchReport: async (id) => {
    await api.deleteReport(id);
    set((s) => ({ researchReports: s.researchReports.filter((r) => r.id !== id) }));
  },

  // -- Dashboard --
  researchDashboardStats: null,

  fetchResearchDashboardStats: async () => {
    try {
      const researchDashboardStats = await api.getDashboardStats();
      set({ researchDashboardStats });
    } catch (err) {
      reportError(err, "Failed to fetch research dashboard stats", set);
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
