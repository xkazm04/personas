import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import type { DevProject } from "@/lib/bindings/DevProject";
import type { DirectoryScanResult } from "@/lib/bindings/DirectoryScanResult";
import type { DevGoal } from "@/lib/bindings/DevGoal";
import type { DevGoalSignal } from "@/lib/bindings/DevGoalSignal";
import type { DevContextGroup } from "@/lib/bindings/DevContextGroup";
import type { DevContext } from "@/lib/bindings/DevContext";
import type { DevContextGroupRelationship } from "@/lib/bindings/DevContextGroupRelationship";
import type { DevIdea } from "@/lib/bindings/DevIdea";
import type { DevScan } from "@/lib/bindings/DevScan";
import type { DevTask } from "@/lib/bindings/DevTask";
import type { TriageRule } from "@/lib/bindings/TriageRule";
import * as devApi from "@/api/devTools/devTools";

export interface DevToolsSlice {
  // -- Projects --------------------------------------------------------
  projects: DevProject[];
  activeProjectId: string | null;
  projectsLoading: boolean;

  fetchProjects: (status?: string) => Promise<void>;
  createProject: (name: string, rootPath: string, description?: string, techStack?: string) => Promise<DevProject>;
  updateProject: (id: string, updates: { name?: string; description?: string; status?: string; techStack?: string }) => Promise<void>;
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

  // -- Context Map -----------------------------------------------------
  contextGroups: DevContextGroup[];
  contexts: DevContext[];
  contextGroupRelationships: DevContextGroupRelationship[];
  contextMapLoading: boolean;
  codebaseScanPhase: "idle" | "scanning" | "complete" | "error";

  fetchContextGroups: (projectId: string) => Promise<void>;
  createContextGroup: (projectId: string, name: string, color: string, icon?: string, groupType?: string) => Promise<DevContextGroup>;
  updateContextGroup: (id: string, updates: { name?: string; color?: string; icon?: string; groupType?: string; healthScore?: number }) => Promise<void>;
  deleteContextGroup: (id: string) => Promise<void>;
  reorderContextGroups: (projectId: string, groupIds: string[]) => Promise<void>;

  fetchContexts: (projectId: string, groupId?: string) => Promise<void>;
  createContext: (projectId: string, name: string, filePaths: string, groupId?: string, description?: string) => Promise<DevContext>;
  updateContext: (id: string, updates: { name?: string; description?: string; filePaths?: string; entryPoints?: string; dbTables?: string; keywords?: string; apiSurface?: string; crossRefs?: string; techStack?: string; groupId?: string }) => Promise<void>;
  deleteContext: (id: string) => Promise<void>;
  moveContext: (id: string, targetGroupId: string | null) => Promise<void>;
  scanCodebase: (projectId: string, rootPath: string) => Promise<void>;
  generateContextDescription: (contextId: string) => Promise<DevContext>;

  fetchContextGroupRelationships: (projectId: string) => Promise<void>;
  createContextGroupRelationship: (projectId: string, sourceGroupId: string, targetGroupId: string) => Promise<DevContextGroupRelationship>;
  deleteContextGroupRelationship: (id: string) => Promise<void>;

  // -- Scanner ---------------------------------------------------------
  scanAgentSelection: string[];
  scanPhase: "idle" | "running" | "complete" | "error";
  scanResults: DevIdea[];
  currentScanId: string | null;

  setScanAgentSelection: (keys: string[]) => void;
  toggleScanAgent: (key: string) => void;
  runScan: (projectId: string, contextId?: string) => Promise<DevScan>;
  fetchScan: (id: string) => Promise<DevScan>;
  fetchScans: (projectId?: string, limit?: number) => Promise<DevScan[]>;

  // -- Ideas -----------------------------------------------------------
  ideas: DevIdea[];
  ideasLoading: boolean;

  fetchIdeas: (projectId?: string, status?: string, category?: string, scanType?: string, limit?: number, offset?: number) => Promise<void>;
  getIdea: (id: string) => Promise<DevIdea>;
  updateIdea: (id: string, updates: { status?: string; title?: string; description?: string; category?: string; effort?: number; impact?: number; risk?: number; rejectionReason?: string }) => Promise<void>;
  deleteIdea: (id: string) => Promise<void>;
  bulkDeleteIdeas: (ids: string[]) => Promise<number>;

  // -- Triage ----------------------------------------------------------
  triageItems: DevIdea[];
  triageCursor: string | null;
  triageHasMore: boolean;
  triageCounts: { total: number; pending: number; accepted: number; rejected: number } | null;
  triageFilterCategory: string | null;
  triageFilterScanType: string | null;

  fetchTriageIdeas: (projectId: string, limit?: number) => Promise<void>;
  fetchMoreTriageIdeas: (projectId: string, limit?: number) => Promise<void>;
  acceptIdea: (id: string) => Promise<void>;
  rejectIdea: (id: string, reason?: string) => Promise<void>;
  deleteTriageIdea: (id: string) => Promise<void>;
  setTriageFilterCategory: (category: string | null) => void;
  setTriageFilterScanType: (scanType: string | null) => void;

  // -- Triage Rules ----------------------------------------------------
  triageRules: TriageRule[];

  fetchTriageRules: (projectId?: string) => Promise<void>;
  createTriageRule: (name: string, conditions: string, action: string, projectId?: string) => Promise<TriageRule>;
  updateTriageRule: (id: string, updates: { name?: string; conditions?: string; action?: string; enabled?: boolean }) => Promise<void>;
  deleteTriageRule: (id: string) => Promise<void>;
  runTriageRules: (projectId: string) => Promise<{ applied: number; ideas_affected: number }>;

  // -- Tasks -----------------------------------------------------------
  tasks: DevTask[];
  tasksLoading: boolean;
  activeBatchId: string | null;

  fetchTasks: (projectId?: string, status?: string, goalId?: string) => Promise<void>;
  createTask: (title: string, projectId?: string, description?: string, sourceIdeaId?: string, goalId?: string) => Promise<DevTask>;
  batchCreateTasks: (tasks: { title: string; description?: string; sourceIdeaId?: string; goalId?: string }[], projectId?: string) => Promise<DevTask[]>;
  startTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  startBatch: (taskIds: string[]) => Promise<{ batch_id: string; started: number }>;
  getBatchStatus: (batchId: string) => Promise<{ batch_id: string; total: number; completed: number; failed: number; running: number; pending: number; tasks: DevTask[] }>;
}

export const createDevToolsSlice: StateCreator<PersonaStore, [], [], DevToolsSlice> = (set, get) => ({
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
      set({ projectsLoading: false, error: errMsg(err, "Failed to fetch projects") });
    }
  },

  createProject: async (name, rootPath, description, techStack) => {
    try {
      const project = await devApi.createProject(name, rootPath, description, techStack);
      set((state) => ({ projects: [...state.projects, project], error: null }));
      return project;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create project") });
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
      set({ error: errMsg(err, "Failed to update project") });
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
      set({ error: errMsg(err, "Failed to delete project") });
    }
  },

  setActiveProject: async (id) => {
    try {
      await devApi.setActiveProject(id);
      set({ activeProjectId: id, error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to set active project") });
    }
  },

  scanDirectory: async (path) => {
    try {
      const result = await devApi.scanDirectory(path);
      return result;
    } catch (err) {
      set({ error: errMsg(err, "Failed to scan directory") });
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
      set({ goalsLoading: false, error: errMsg(err, "Failed to fetch goals") });
    }
  },

  createGoal: async (projectId, title, description, contextId, targetDate) => {
    try {
      const goal = await devApi.createGoal(projectId, title, description, contextId, targetDate);
      set((state) => ({ goals: [...state.goals, goal], error: null }));
      return goal;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create goal") });
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
      set({ error: errMsg(err, "Failed to update goal") });
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
      set({ error: errMsg(err, "Failed to delete goal") });
    }
  },

  reorderGoals: async (projectId, goalIds) => {
    try {
      await devApi.reorderGoals(projectId, goalIds);
      // Re-fetch to get updated order_index values
      await get().fetchGoals(projectId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to reorder goals") });
    }
  },

  recordGoalSignal: async (goalId, signalType, delta, message, sourceId) => {
    try {
      const signal = await devApi.recordGoalSignal(goalId, signalType, delta, message, sourceId);
      set((state) => ({ goalSignals: [...state.goalSignals, signal], error: null }));
      return signal;
    } catch (err) {
      set({ error: errMsg(err, "Failed to record goal signal") });
      throw err;
    }
  },

  fetchGoalSignals: async (goalId) => {
    try {
      const goalSignals = await devApi.listGoalSignals(goalId);
      set({ goalSignals, error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch goal signals") });
    }
  },

  // -- Context Map state -----------------------------------------------
  contextGroups: [],
  contexts: [],
  contextGroupRelationships: [],
  contextMapLoading: false,
  codebaseScanPhase: "idle",

  fetchContextGroups: async (projectId) => {
    set({ contextMapLoading: true });
    try {
      const contextGroups = await devApi.listContextGroups(projectId);
      set({ contextGroups, contextMapLoading: false, error: null });
    } catch (err) {
      set({ contextMapLoading: false, error: errMsg(err, "Failed to fetch context groups") });
    }
  },

  createContextGroup: async (projectId, name, color, icon, groupType) => {
    try {
      const group = await devApi.createContextGroup(projectId, name, color, icon, groupType);
      set((state) => ({ contextGroups: [...state.contextGroups, group], error: null }));
      return group;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create context group") });
      throw err;
    }
  },

  updateContextGroup: async (id, updates) => {
    try {
      const updated = await devApi.updateContextGroup(id, updates);
      set((state) => ({
        contextGroups: state.contextGroups.map((g) => (g.id === id ? updated : g)),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update context group") });
    }
  },

  deleteContextGroup: async (id) => {
    try {
      await devApi.deleteContextGroup(id);
      set((state) => ({
        contextGroups: state.contextGroups.filter((g) => g.id !== id),
        contexts: state.contexts.map((c) =>
          c.group_id === id ? { ...c, group_id: null } : c,
        ),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete context group") });
    }
  },

  reorderContextGroups: async (projectId, groupIds) => {
    try {
      await devApi.reorderContextGroups(projectId, groupIds);
      await get().fetchContextGroups(projectId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to reorder context groups") });
    }
  },

  fetchContexts: async (projectId, groupId) => {
    set({ contextMapLoading: true });
    try {
      const contexts = await devApi.listContexts(projectId, groupId);
      set({ contexts, contextMapLoading: false, error: null });
    } catch (err) {
      set({ contextMapLoading: false, error: errMsg(err, "Failed to fetch contexts") });
    }
  },

  createContext: async (projectId, name, filePaths, groupId, description) => {
    try {
      const ctx = await devApi.createContext(projectId, name, filePaths, groupId, description);
      set((state) => ({ contexts: [...state.contexts, ctx], error: null }));
      return ctx;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create context") });
      throw err;
    }
  },

  updateContext: async (id, updates) => {
    try {
      const updated = await devApi.updateContext(id, updates);
      set((state) => ({
        contexts: state.contexts.map((c) => (c.id === id ? updated : c)),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update context") });
    }
  },

  deleteContext: async (id) => {
    try {
      await devApi.deleteContext(id);
      set((state) => ({
        contexts: state.contexts.filter((c) => c.id !== id),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete context") });
    }
  },

  moveContext: async (id, targetGroupId) => {
    try {
      const updated = await devApi.moveContext(id, targetGroupId);
      set((state) => ({
        contexts: state.contexts.map((c) => (c.id === id ? updated : c)),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to move context") });
    }
  },

  scanCodebase: async (projectId, rootPath) => {
    set({ codebaseScanPhase: "scanning" });
    try {
      const contexts = await devApi.scanCodebase(projectId, rootPath);
      set((state) => ({
        contexts: [...state.contexts.filter((c) => c.project_id !== projectId), ...contexts],
        codebaseScanPhase: "complete",
        error: null,
      }));
    } catch (err) {
      set({ codebaseScanPhase: "error", error: errMsg(err, "Failed to scan codebase") });
    }
  },

  generateContextDescription: async (contextId) => {
    try {
      const updated = await devApi.generateContextDescription(contextId);
      set((state) => ({
        contexts: state.contexts.map((c) => (c.id === contextId ? updated : c)),
        error: null,
      }));
      return updated;
    } catch (err) {
      set({ error: errMsg(err, "Failed to generate context description") });
      throw err;
    }
  },

  fetchContextGroupRelationships: async (projectId) => {
    try {
      const contextGroupRelationships = await devApi.listContextGroupRelationships(projectId);
      set({ contextGroupRelationships, error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch context group relationships") });
    }
  },

  createContextGroupRelationship: async (projectId, sourceGroupId, targetGroupId) => {
    try {
      const rel = await devApi.createContextGroupRelationship(projectId, sourceGroupId, targetGroupId);
      set((state) => ({ contextGroupRelationships: [...state.contextGroupRelationships, rel], error: null }));
      return rel;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create context group relationship") });
      throw err;
    }
  },

  deleteContextGroupRelationship: async (id) => {
    try {
      await devApi.deleteContextGroupRelationship(id);
      set((state) => ({
        contextGroupRelationships: state.contextGroupRelationships.filter((r) => r.id !== id),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete context group relationship") });
    }
  },

  // -- Scanner state ---------------------------------------------------
  scanAgentSelection: [],
  scanPhase: "idle",
  scanResults: [],
  currentScanId: null,

  setScanAgentSelection: (keys) => {
    set({ scanAgentSelection: keys });
  },

  toggleScanAgent: (key) => {
    set((state) => {
      const exists = state.scanAgentSelection.includes(key);
      return {
        scanAgentSelection: exists
          ? state.scanAgentSelection.filter((k) => k !== key)
          : [...state.scanAgentSelection, key],
      };
    });
  },

  runScan: async (projectId, contextId) => {
    const { scanAgentSelection } = get();
    set({ scanPhase: "running", scanResults: [], currentScanId: null });
    try {
      const scan = await devApi.runScan(projectId, scanAgentSelection, contextId);
      // Fetch the ideas generated by this scan
      const ideas = await devApi.listIdeas(projectId, undefined, undefined, undefined);
      set({ scanPhase: "complete", currentScanId: scan.id, scanResults: ideas, error: null });
      return scan;
    } catch (err) {
      set({ scanPhase: "error", error: errMsg(err, "Scan failed") });
      throw err;
    }
  },

  fetchScan: async (id) => {
    try {
      const scan = await devApi.getScan(id);
      return scan;
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch scan") });
      throw err;
    }
  },

  fetchScans: async (projectId, limit) => {
    try {
      const scans = await devApi.listScans(projectId, limit);
      return scans;
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch scans") });
      throw err;
    }
  },

  // -- Ideas state -----------------------------------------------------
  ideas: [],
  ideasLoading: false,

  fetchIdeas: async (projectId, status, category, scanType, limit, offset) => {
    set({ ideasLoading: true });
    try {
      const ideas = await devApi.listIdeas(projectId, status, category, scanType, limit, offset);
      set({ ideas, ideasLoading: false, error: null });
    } catch (err) {
      set({ ideasLoading: false, error: errMsg(err, "Failed to fetch ideas") });
    }
  },

  getIdea: async (id) => {
    try {
      return await devApi.getIdea(id);
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch idea") });
      throw err;
    }
  },

  updateIdea: async (id, updates) => {
    try {
      const updated = await devApi.updateIdea(id, updates);
      set((state) => ({
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update idea") });
    }
  },

  deleteIdea: async (id) => {
    try {
      await devApi.deleteIdea(id);
      set((state) => ({
        ideas: state.ideas.filter((i) => i.id !== id),
        triageItems: state.triageItems.filter((i) => i.id !== id),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete idea") });
    }
  },

  bulkDeleteIdeas: async (ids) => {
    try {
      const count = await devApi.bulkDeleteIdeas(ids);
      const idSet = new Set(ids);
      set((state) => ({
        ideas: state.ideas.filter((i) => !idSet.has(i.id)),
        triageItems: state.triageItems.filter((i) => !idSet.has(i.id)),
        error: null,
      }));
      return count;
    } catch (err) {
      set({ error: errMsg(err, "Failed to bulk delete ideas") });
      throw err;
    }
  },

  // -- Triage state ----------------------------------------------------
  triageItems: [],
  triageCursor: null,
  triageHasMore: false,
  triageCounts: null,
  triageFilterCategory: null,
  triageFilterScanType: null,

  fetchTriageIdeas: async (projectId, limit) => {
    try {
      const result = await devApi.triageIdeas(projectId, limit);
      set({
        triageItems: result.ideas,
        triageCursor: result.cursor,
        triageHasMore: result.has_more,
        triageCounts: result.counts,
        error: null,
      });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch triage ideas") });
    }
  },

  fetchMoreTriageIdeas: async (projectId, limit) => {
    const { triageCursor } = get();
    if (!triageCursor) return;
    try {
      const result = await devApi.triageIdeas(projectId, limit, triageCursor);
      set((state) => ({
        triageItems: [...state.triageItems, ...result.ideas],
        triageCursor: result.cursor,
        triageHasMore: result.has_more,
        triageCounts: result.counts,
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch more triage ideas") });
    }
  },

  acceptIdea: async (id) => {
    try {
      const updated = await devApi.acceptIdea(id);
      set((state) => ({
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        triageCounts: state.triageCounts
          ? { ...state.triageCounts, pending: state.triageCounts.pending - 1, accepted: state.triageCounts.accepted + 1 }
          : null,
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to accept idea") });
    }
  },

  rejectIdea: async (id, reason) => {
    try {
      const updated = await devApi.rejectIdea(id, reason);
      set((state) => ({
        triageItems: state.triageItems.map((i) => (i.id === id ? updated : i)),
        ideas: state.ideas.map((i) => (i.id === id ? updated : i)),
        triageCounts: state.triageCounts
          ? { ...state.triageCounts, pending: state.triageCounts.pending - 1, rejected: state.triageCounts.rejected + 1 }
          : null,
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to reject idea") });
    }
  },

  deleteTriageIdea: async (id) => {
    try {
      await devApi.deleteTriageIdea(id);
      set((state) => ({
        triageItems: state.triageItems.filter((i) => i.id !== id),
        triageCounts: state.triageCounts
          ? { ...state.triageCounts, total: state.triageCounts.total - 1, pending: state.triageCounts.pending - 1 }
          : null,
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete triage idea") });
    }
  },

  setTriageFilterCategory: (category) => {
    set({ triageFilterCategory: category });
  },

  setTriageFilterScanType: (scanType) => {
    set({ triageFilterScanType: scanType });
  },

  // -- Triage Rules state ----------------------------------------------
  triageRules: [],

  fetchTriageRules: async (projectId) => {
    try {
      const triageRules = await devApi.listTriageRules(projectId);
      set({ triageRules, error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch triage rules") });
    }
  },

  createTriageRule: async (name, conditions, action, projectId) => {
    try {
      const rule = await devApi.createTriageRule(name, conditions, action, projectId);
      set((state) => ({ triageRules: [...state.triageRules, rule], error: null }));
      return rule;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create triage rule") });
      throw err;
    }
  },

  updateTriageRule: async (id, updates) => {
    try {
      const updated = await devApi.updateTriageRule(id, updates);
      set((state) => ({
        triageRules: state.triageRules.map((r) => (r.id === id ? updated : r)),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update triage rule") });
    }
  },

  deleteTriageRule: async (id) => {
    try {
      await devApi.deleteTriageRule(id);
      set((state) => ({
        triageRules: state.triageRules.filter((r) => r.id !== id),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete triage rule") });
    }
  },

  runTriageRules: async (projectId) => {
    try {
      const result = await devApi.runTriageRules(projectId);
      // Re-fetch triage items to reflect changes
      await get().fetchTriageIdeas(projectId);
      return result;
    } catch (err) {
      set({ error: errMsg(err, "Failed to run triage rules") });
      throw err;
    }
  },

  // -- Tasks state -----------------------------------------------------
  tasks: [],
  tasksLoading: false,
  activeBatchId: null,

  fetchTasks: async (projectId, status, goalId) => {
    set({ tasksLoading: true });
    try {
      const tasks = await devApi.listTasks(projectId, status, goalId);
      set({ tasks, tasksLoading: false, error: null });
    } catch (err) {
      set({ tasksLoading: false, error: errMsg(err, "Failed to fetch tasks") });
    }
  },

  createTask: async (title, projectId, description, sourceIdeaId, goalId) => {
    try {
      const task = await devApi.createTask(title, projectId, description, sourceIdeaId, goalId);
      set((state) => ({ tasks: [...state.tasks, task], error: null }));
      return task;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create task") });
      throw err;
    }
  },

  batchCreateTasks: async (tasks, projectId) => {
    try {
      const created = await devApi.batchCreateTasks(tasks, projectId);
      set((state) => ({ tasks: [...state.tasks, ...created], error: null }));
      return created;
    } catch (err) {
      set({ error: errMsg(err, "Failed to batch create tasks") });
      throw err;
    }
  },

  startTask: async (id) => {
    try {
      const updated = await devApi.startTask(id);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to start task") });
    }
  },

  cancelTask: async (id) => {
    try {
      const updated = await devApi.cancelTask(id);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        error: null,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to cancel task") });
    }
  },

  startBatch: async (taskIds) => {
    try {
      const result = await devApi.startBatch(taskIds);
      set({ activeBatchId: result.batch_id, error: null });
      return result;
    } catch (err) {
      set({ error: errMsg(err, "Failed to start batch") });
      throw err;
    }
  },

  getBatchStatus: async (batchId) => {
    try {
      const result = await devApi.getBatchStatus(batchId);
      set((state) => ({
        tasks: state.tasks.map((t) => {
          const updated = result.tasks.find((rt) => rt.id === t.id);
          return updated ?? t;
        }),
        error: null,
      }));
      return result;
    } catch (err) {
      set({ error: errMsg(err, "Failed to get batch status") });
      throw err;
    }
  },
});
