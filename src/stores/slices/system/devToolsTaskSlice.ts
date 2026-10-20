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
 * additionally freed wholesale on terminal status by the Run Desk's
 * `useTaskQueue`.
 */
const MAX_TASK_OUTPUT_LINES = 1000;

/**
 * Flush interval (ms) for batching streamed output lines into the store.
 * A running task streams tens of lines per second; writing each line as its
 * own zustand `set()` copies the ring array and notifies every subscriber
 * per line. Buffering lines and flushing once per interval keeps the UI
 * fresh (~12 Hz) while doing one store transaction per window instead of
 * one per line.
 */
const OUTPUT_FLUSH_INTERVAL_MS = 80;

export interface DevToolsTaskSlice {
  // -- Tasks -----------------------------------------------------------
  tasks: DevTask[];
  taskOutputBuffers: Record<string, string[]>;
  maxParallelTasks: number;

  fetchTasks: (projectId?: string, status?: string, goalId?: string) => Promise<void>;
  /**
   * Replace the task window wholesale. The Run Desk owns a *paged* window
   * (keyset page of 40 + status filter) rather than the whole project, and
   * mirrors it here so the store stays the single render/patch source for
   * every task consumer (cards, SelfHealingPanel, goal spotlight).
   */
  setTasks: (tasks: DevTask[]) => void;
  /**
   * Patch ONE task row in place from a live execution event.
   *
   * The old Task Runner refetched the whole project on every
   * `TASK_EXEC_STATUS`/`TASK_EXEC_COMPLETE` event — an O(project) IPC round
   * trip per status tick, which is why a 40-task auto-run melted the queue.
   * Status/progress/error/completion deltas are fully described by the event
   * payload, so they are applied locally; only a transition that can move a
   * row in or out of the active filter window triggers a reload.
   *
   * No-ops (returns an unchanged state object) when the id is not in the
   * current window, so an event for an off-window task can't force a
   * re-render of every card.
   */
  patchTask: (id: string, partial: Partial<DevTask>) => void;
  createTask: (title: string, projectId?: string, description?: string, sourceIdeaId?: string, goalId?: string, depth?: string) => Promise<DevTask>;
  batchCreateTasks: (tasks: { title: string; description?: string; sourceIdeaId?: string; goalId?: string }[], projectId?: string) => Promise<DevTask[]>;
  startBatch: (taskIds: string[]) => Promise<{ batch_id: string; started: number }>;
  appendTaskOutput: (taskId: string, line: string) => void;
  clearTaskOutput: (taskId: string) => void;
  setMaxParallelTasks: (n: number) => void;
}

export const createDevToolsTaskSlice: StateCreator<SystemStore, [], [], DevToolsTaskSlice> = (set, get) => {
  // Pending streamed lines, buffered outside the store between flushes.
  // Kept in the creator closure (not module scope) so each store instance
  // owns its own buffer.
  const pendingLines = new Map<string, string[]>();
  let flushScheduled = false;

  const flushPendingOutput = () => {
    flushScheduled = false;
    if (pendingLines.size === 0) return;
    // Snapshot and clear before set() so the updater stays pure.
    const batches = new Map(pendingLines);
    pendingLines.clear();
    set((state) => {
      const buffers = { ...state.taskOutputBuffers };
      for (const [taskId, lines] of batches) {
        const prev = buffers[taskId] ?? [];
        // Bounded ring: keep at most MAX_TASK_OUTPUT_LINES, applying the cap
        // once per flush instead of once per line.
        const merged = [...prev, ...lines];
        buffers[taskId] =
          merged.length > MAX_TASK_OUTPUT_LINES
            ? merged.slice(merged.length - MAX_TASK_OUTPUT_LINES)
            : merged;
      }
      return { taskOutputBuffers: buffers };
    });
  };

  return {
  // -- Tasks state -----------------------------------------------------
  tasks: [],
  taskOutputBuffers: {},
  maxParallelTasks: 2,

  fetchTasks: async (projectId, status, goalId) => {
    try {
      const tasks = await devApi.listTasks(projectId, status, goalId);
      set({ tasks, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch tasks", set);
    }
  },

  setTasks: (tasks) => {
    set({ tasks });
  },

  patchTask: (id, partial) => {
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === id);
      const current = idx === -1 ? undefined : state.tasks[idx];
      if (!current) return {};
      const next = state.tasks.slice();
      next[idx] = { ...current, ...partial };
      return { tasks: next };
    });
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

  startBatch: async (taskIds) => {
    try {
      const maxParallel = get().maxParallelTasks;
      const result = await devApi.startBatchExecution(taskIds, maxParallel);
      set({ error: null });
      return result;
    } catch (err) {
      reportError(err, "Failed to start batch", set);
      throw err;
    }
  },

  appendTaskOutput: (taskId, line) => {
    const buf = pendingLines.get(taskId);
    if (buf) {
      buf.push(line);
      // Cap the pending buffer too so a chatty task between flushes never
      // holds more than one ring's worth of lines.
      if (buf.length > MAX_TASK_OUTPUT_LINES) {
        buf.splice(0, buf.length - MAX_TASK_OUTPUT_LINES);
      }
    } else {
      pendingLines.set(taskId, [line]);
    }
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flushPendingOutput, OUTPUT_FLUSH_INTERVAL_MS);
    }
  },

  clearTaskOutput: (taskId) => {
    // Drop any not-yet-flushed lines so they don't resurrect the buffer.
    pendingLines.delete(taskId);
    set((state) => {
      const { [taskId]: _, ...rest } = state.taskOutputBuffers;
      return { taskOutputBuffers: rest };
    });
  },

  setMaxParallelTasks: (n) => {
    set({ maxParallelTasks: n });
  },
  };
};
