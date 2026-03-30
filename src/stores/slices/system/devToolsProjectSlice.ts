import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { DevProject } from "@/lib/bindings/DevProject";
import type { DirectoryScanResult } from "@/lib/bindings/DirectoryScanResult";
import type { DevGoal } from "@/lib/bindings/DevGoal";
import type { DevGoalSignal } from "@/lib/bindings/DevGoalSignal";
import * as devApi from "@/api/devTools/devTools";

export interface DevToolsProjectSlice {
  // -- Projects --------------------------------------------------------
  projects: DevProject[];
  activeProjectId: string | null;
  projectsLoading: boolean;

  fetchProjects: (status?: string) => Promise<void>;
  createProject: (name: string, rootPath: string, description?: string, techStack?: string, githubUrl?: string) => Promise<DevProject>;
  updateProject: (id: string, updates: { name?: string; description?: string; status?: string; techStack?: string; githubUrl?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setActiveProject: (id: string | null) => Promise<void>;
  scanDirectory: (path: string) => Promise<DirectoryScanResult>;

  // -- Goals -----------------------------------------------------------
  goals: DevGoal[];
  goalsLoading: boolean;
  goalSignals: DevGoalSignal[];

  fetchGoals: (projectId: string) => Promise<void>;
  createGoal: (projectId: string, title: string, description?: string, contextId?: string, targetDate?: string) => Promise<DevGoal>;
  updateGoal: (id: string, updates: { title?: string; description?: string; status?: string; progress?: number; targetDate?: string; contextId?: string }) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  reorderGoals: (projectId: string, goalIds: string[]) => Promise<void>;
  recordGoalSignal: (goalId: string, signalType: string, delta?: number, message?: string, sourceId?: string) => Promise<DevGoalSignal>;
  fetchGoalSignals: (goalId: string) => Promise<void>;
}

export const createDevToolsProjectSlice: StateCreator<SystemStore, [], [], DevToolsProjectSlice> = (set, get) => ({
  // -- Projects state --------------------------------------------------
  projects: [],
  activeProjectId: null,
  projectsLoading: false,

  fetchProjects: async (status) => {
    set({ projectsLoading: true });
    try {
      const projects = await devApi.listProjects(status);
      set({ projects, projectsLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch projects", set, { stateUpdates: { projectsLoading: false } });
    }
  },

  createProject: async (name, rootPath, description, techStack, githubUrl) => {
    try {
      const project = await devApi.createProject(name, rootPath, description, techStack, githubUrl);
      set((state) => ({ projects: [...state.projects, project], error: null }));
      return project;
    } catch (err) {
      reportError(err, "Failed to create project", set);
      throw err;
    }
  },

  updateProject: async (id, updates) => {
    try {
      const updated = await devApi.updateProject(id, updates);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updated : p)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update project", set);
    }
  },

  deleteProject: async (id) => {
    try {
      await devApi.deleteProject(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete project", set);
    }
  },

  setActiveProject: async (id) => {
    try {
      await devApi.setActiveProject(id);
      set({ activeProjectId: id, error: null });
    } catch (err) {
      reportError(err, "Failed to set active project", set);
    }
  },

  scanDirectory: async (path) => {
    try {
      const result = await devApi.scanDirectory(path);
      return result;
    } catch (err) {
      reportError(err, "Failed to scan directory", set);
      throw err;
    }
  },

  // -- Goals state -----------------------------------------------------
  goals: [],
  goalsLoading: false,
  goalSignals: [],

  fetchGoals: async (projectId) => {
    set({ goalsLoading: true });
    try {
      const goals = await devApi.listGoals(projectId);
      set({ goals, goalsLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch goals", set, { stateUpdates: { goalsLoading: false } });
    }
  },

  createGoal: async (projectId, title, description, contextId, targetDate) => {
    try {
      const goal = await devApi.createGoal(projectId, title, description, contextId, targetDate);
      set((state) => ({ goals: [...state.goals, goal], error: null }));
      return goal;
    } catch (err) {
      reportError(err, "Failed to create goal", set);
      throw err;
    }
  },

  updateGoal: async (id, updates) => {
    try {
      const updated = await devApi.updateGoal(id, updates);
      set((state) => ({
        goals: state.goals.map((g) => (g.id === id ? updated : g)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update goal", set);
    }
  },

  deleteGoal: async (id) => {
    try {
      await devApi.deleteGoal(id);
      set((state) => ({
        goals: state.goals.filter((g) => g.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete goal", set);
    }
  },

  reorderGoals: async (projectId, goalIds) => {
    try {
      await devApi.reorderGoals(projectId, goalIds);
      // Re-fetch to get updated order_index values
      await get().fetchGoals(projectId);
    } catch (err) {
      reportError(err, "Failed to reorder goals", set);
    }
  },

  recordGoalSignal: async (goalId, signalType, delta, message, sourceId) => {
    try {
      const signal = await devApi.recordGoalSignal(goalId, signalType, delta, message, sourceId);
      set((state) => ({ goalSignals: [...state.goalSignals, signal], error: null }));
      return signal;
    } catch (err) {
      reportError(err, "Failed to record goal signal", set);
      throw err;
    }
  },

  fetchGoalSignals: async (goalId) => {
    try {
      const goalSignals = await devApi.listGoalSignals(goalId);
      set({ goalSignals, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch goal signals", set);
    }
  },
});
