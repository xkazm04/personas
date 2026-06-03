import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { DevTask } from "@/lib/bindings/DevTask";
import * as devApi from "@/api/devTools/devTools";

/**
 * Bounded ring size for a task's streamed output buffer.
 *
 * The runner allows up to ~10 minutes of streamed output per task, and an
 * auto-run can churn through dozens of tasks back-to-back. Without a cap,
 * `appendTaskOutput` grows `taskOutputBuffers[taskId]` without bound and each
 * append becomes an O(n) array copy (O(n^2) overall), eventually janking then
 * freezing the renderer. Keeping only the most recent lines makes append
 * O(cap) (effectively O(1) amortized) and per-task memory flat regardless of
 * how chatty a task is. This mirrors the Rust-side stderr ring (200 lines /
 * 32 KB) with extra headroom for on-screen review. Completed/failed buffers are
 * additionally freed wholesale on terminal status by TaskRunnerPage.
 */
const MAX_TASK_OUTPUT_LINES = 1000;

export interface DevToolsTaskSlice {
  // -- Tasks -----------------------------------------------------------
  tasks: DevTask[];
  tasksLoading: boolean;
  activeBatchId: string | null;
  taskOutputBuffers: Record<string, string[]>;
  maxParallelTasks: number;

  fetchTasks: (projectId?: string, status?: string, goalId?: string) => Promise<void>;
  createTask: (title: string, projectId?: string, description?: string, sourceIdeaId?: string, goalId?: string, depth?: string) => Promise<DevTask>;
  batchCreateTasks: (tasks: { title: string; description?: string; sourceIdeaId?: string; goalId?: string }[], projectId?: string) => Promise<DevTask[]>;
  startTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  startBatch: (taskIds: string[]) => Promise<{ batch_id: string; started: number }>;
  getBatchStatus: (batchId: string) => Promise<{ batch_id: string; total: number; completed: number; failed: number; running: number; pending: number; tasks: DevTask[] }>;
  appendTaskOutput: (taskId: string, line: string) => void;
  clearTaskOutput: (taskId: string) => void;
  setMaxParallelTasks: (n: number) => void;
}

export const createDevToolsTaskSlice: StateCreator<SystemStore, [], [], DevToolsTaskSlice> = (set, get) => ({
  // -- Tasks state -----------------------------------------------------
  tasks: [],
  tasksLoading: false,
  activeBatchId: null,
  taskOutputBuffers: {},
  maxParallelTasks: 2,

  fetchTasks: async (projectId, status, goalId) => {
    set({ tasksLoading: true });
    try {
      const tasks = await devApi.listTasks(projectId, status, goalId);
      set({ tasks, tasksLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch tasks", set, { stateUpdates: { tasksLoading: false } });
    }
  },

  createTask: async (title, projectId, description, sourceIdeaId, goalId, depth) => {
    try {
      const task = await devApi.createTask(title, projectId, description, sourceIdeaId, goalId, depth);
      set((state) => ({ tasks: [...state.tasks, task], error: null }));
      return task;
    } catch (err) {
      reportError(err, "Failed to create task", set);
      throw err;
    }
  },

  batchCreateTasks: async (tasks, projectId) => {
    try {
      const created = await devApi.batchCreateTasks(tasks, projectId);
      set((state) => ({ tasks: [...state.tasks, ...created], error: null }));
      return created;
    } catch (err) {
      reportError(err, "Failed to batch create tasks", set);
      throw err;
    }
  },

  startTask: async (id) => {
    try {
      await devApi.executeTask(id);
      // Tasks will update via event listeners
    } catch (err) {
      reportError(err, "Failed to start task", set);
    }
  },

  cancelTask: async (id) => {
    try {
      await devApi.cancelTaskExecution(id);
      // Refetch to get updated status
    } catch (err) {
      reportError(err, "Failed to cancel task", set);
    }
  },

  startBatch: async (taskIds) => {
    try {
      const maxParallel = get().maxParallelTasks;
      const result = await devApi.startBatchExecution(taskIds, maxParallel);
      set({ activeBatchId: result.batch_id, error: null });
      return result;
    } catch (err) {
      reportError(err, "Failed to start batch", set);
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
      reportError(err, "Failed to get batch status", set);
      throw err;
    }
  },

  appendTaskOutput: (taskId, line) => {
    set((state) => {
      const prev = state.taskOutputBuffers[taskId] ?? [];
      // Bounded ring: once at capacity, drop the oldest line(s) so the buffer
      // holds at most MAX_TASK_OUTPUT_LINES. slice() keeps the copy bounded to
      // the cap, so append stays O(cap) instead of O(total lines streamed).
      const next =
        prev.length >= MAX_TASK_OUTPUT_LINES
          ? [...prev.slice(prev.length - MAX_TASK_OUTPUT_LINES + 1), line]
          : [...prev, line];
      return {
        taskOutputBuffers: {
          ...state.taskOutputBuffers,
          [taskId]: next,
        },
      };
    });
  },

  clearTaskOutput: (taskId) => {
    set((state) => {
      const { [taskId]: _, ...rest } = state.taskOutputBuffers;
      return { taskOutputBuffers: rest };
    });
  },

  setMaxParallelTasks: (n) => {
    set({ maxParallelTasks: n });
  },
});
