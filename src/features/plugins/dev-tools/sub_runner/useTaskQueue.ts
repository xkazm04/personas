import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { useLayeredList, type LayeredPage } from '@/hooks/utility/data/useLayeredList';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { silentCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import type { DevTask } from '@/lib/bindings/DevTask';

/**
 * The task status vocabulary after the P3 migration normalized the legacy
 * `pending` rows away. Anything the backend sends outside this set falls back
 * to `queued` at the view layer.
 */
export const TASK_STATUSES = ['running', 'queued', 'failed', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** `all` = no server-side status filter. */
export type TaskStatusFilter = TaskStatus | 'all';

export type TaskCounts = Partial<Record<string, number>>;

/** Rows per keyset page — mirrors `dev_tools_tasks_page`'s clamp. */
const PAGE_SIZE = 40;

/** Debounce for the counts refresh triggered by execution events. */
const COUNTS_REFRESH_DEBOUNCE_MS = 600;

export interface UseTaskQueueOptions {
  projectId?: string;
  statusFilter: TaskStatusFilter;
  enabled?: boolean;
}

export interface UseTaskQueueResult {
  /** The loaded window, in server order (created_at DESC). */
  tasks: DevTask[];
  /** Per-status totals for the whole project — NOT scoped to the filter. */
  counts: TaskCounts;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  sentinelRef: (el: HTMLElement | null) => void;
  loadMore: () => void;
  /** Full reload (page + counts). Use after a mutation the events don't cover. */
  reload: () => void;
  /** Refresh only the L0 counts. */
  refreshCounts: () => void;
  /**
   * Per-task context warnings harvested from `TASK_EXEC_COMPLETE`. Not durable
   * — `DevTask` has no column for them, so they live for the session only.
   */
  contextWarnings: Record<string, string[]>;
}

function normalizeStatus(status: string): TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(status) ? (status as TaskStatus) : 'queued';
}

const TERMINAL: readonly string[] = ['completed', 'failed', 'cancelled'];

/**
 * Layered-list data source for the Run Desk queue.
 *
 * - **L0** — `tasksPage(..., limit 1).counts` gives per-status totals for the
 *   whole project, so the filter chips stay truthful beyond the loaded page.
 * - **L1** — one keyset page of {@link PAGE_SIZE} rows for the active filter.
 * - **L2** — `sentinelRef` pulls the next keyset page on scroll.
 *
 * **Event flow** (the core fix over the old Task Runner, which refetched the
 * whole project on every event):
 * - `TASK_EXEC_OUTPUT` → the store's bounded output ring (`appendTaskOutput`);
 *   never touches the row list.
 * - `TASK_EXEC_STATUS` / `TASK_EXEC_COMPLETE` → `patchTask(id, partial)`,
 *   an in-place single-row update. A **reload** happens only when the
 *   transition can move the row across the active filter window (i.e. a
 *   concrete status filter is active) — otherwise just the counts refresh.
 * - `AUTO_RUN_COMPLETE` → full reload (the run touched many rows at once).
 *
 * The loaded window is mirrored into `systemStore.tasks` so every existing
 * task consumer (cards, SelfHealingPanel, goal spotlight) keeps reading one
 * source, and `patchTask` has something to patch.
 */
export function useTaskQueue({ projectId, statusFilter, enabled = true }: UseTaskQueueOptions): UseTaskQueueResult {
  const filterKey = `${projectId ?? 'all'}::${statusFilter}`;

  const [counts, setCounts] = useState<TaskCounts>({});
  const [contextWarnings, setContextWarnings] = useState<Record<string, string[]>>({});

  // Patches applied since the last server page. Re-applied whenever the
  // layered list hands us a new `rows` identity (a `loadMore` append would
  // otherwise resurrect the stale server copy of an already-patched row).
  // Cleared on reload — the server is authoritative there.
  const patchesRef = useRef(new Map<string, Partial<DevTask>>());

  const statuses = useMemo(
    () => (statusFilter === 'all' ? undefined : [statusFilter]),
    [statusFilter],
  );

  const list = useLayeredList<DevTask, TaskCounts>({
    filterKey,
    enabled,
    fetchPage: useCallback(
      (cursor: string | null): Promise<LayeredPage<DevTask>> =>
        devApi.tasksPage(projectId, statuses, PAGE_SIZE, cursor ?? undefined).then((page) => ({
          rows: page.tasks,
          nextCursor: page.cursor,
          hasMore: page.has_more,
        })),
      [projectId, statuses],
    ),
  });

  const { rows, reload: listReload } = list;

  const refreshCounts = useCallback(() => {
    if (!enabled) return;
    devApi
      .tasksPage(projectId, undefined, 1)
      .then((page) => setCounts(page.counts))
      .catch(silentCatch('features/plugins/dev-tools/sub_runner/useTaskQueue:counts'));
  }, [projectId, enabled]);

  // L0 — counts land independently of (and usually before) the row page.
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const reload = useCallback(() => {
    patchesRef.current.clear();
    listReload();
    refreshCounts();
  }, [listReload, refreshCounts]);

  // Mirror the loaded window into the store, re-applying live patches on top
  // of the server rows so a page append never rolls a row back.
  const setStoreTasks = useSystemStore((s) => s.setTasks);
  useEffect(() => {
    const patches = patchesRef.current;
    setStoreTasks(
      patches.size === 0
        ? rows
        : rows.map((r) => {
            const p = patches.get(r.id);
            return p ? { ...r, ...p } : r;
          }),
    );
  }, [rows, setStoreTasks]);

  // --- Live execution events -------------------------------------------
  // Latest-value refs keep the listener effect mount-once (re-subscribing on
  // every filter change would drop lines mid-stream).
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const refreshCountsRef = useRef(refreshCounts);
  refreshCountsRef.current = refreshCounts;

  useEffect(() => {
    let countsTimer: number | undefined;
    const scheduleCountsRefresh = () => {
      if (countsTimer !== undefined) window.clearTimeout(countsTimer);
      countsTimer = window.setTimeout(() => refreshCountsRef.current(), COUNTS_REFRESH_DEBOUNCE_MS);
    };

    const applyPatch = (id: string, partial: Partial<DevTask>) => {
      const prev = patchesRef.current.get(id);
      patchesRef.current.set(id, prev ? { ...prev, ...partial } : partial);
      useSystemStore.getState().patchTask(id, partial);
    };

    const outputUn = listen<{ job_id: string; line: string }>(EventName.TASK_EXEC_OUTPUT, (event) => {
      // Unchanged path: the bounded ring buffer in devToolsTaskSlice.
      useSystemStore.getState().appendTaskOutput(event.payload.job_id, event.payload.line);
    });

    const statusUn = listen<{ job_id: string; status: string; error?: string }>(
      EventName.TASK_EXEC_STATUS,
      (event) => {
        const { job_id, status, error } = event.payload;
        const terminal = TERMINAL.includes(status);
        if (terminal) {
          // Free the streamed ring on terminal status. failed/cancelled only
          // emit TASK_EXEC_STATUS, so this stays the one terminal hook.
          useSystemStore.getState().clearTaskOutput(job_id);
        }
        applyPatch(job_id, {
          status,
          ...(error ? { error } : {}),
          ...(terminal ? { completed_at: new Date().toISOString() } : {}),
          ...(status === 'completed' ? { progress_pct: 100 } : {}),
        });
        scheduleCountsRefresh();
        // A concrete status filter means this transition can move the row out
        // of (or into) the window — only then do we pay for a refetch.
        if (statusFilterRef.current !== 'all') reloadRef.current();
      },
    );

    const completeUn = listen<{ task_id: string; output_lines: number; context_warnings?: string[] }>(
      EventName.TASK_EXEC_COMPLETE,
      (event) => {
        const { task_id, output_lines, context_warnings } = event.payload;
        if (context_warnings && context_warnings.length > 0) {
          setContextWarnings((prev) => ({ ...prev, [task_id]: context_warnings }));
        }
        applyPatch(task_id, {
          status: 'completed',
          progress_pct: 100,
          output_lines,
          completed_at: new Date().toISOString(),
        });
        scheduleCountsRefresh();
        if (statusFilterRef.current !== 'all') reloadRef.current();
        window.setTimeout(() => {
          const stillRunning = useSystemStore.getState().tasks.some((t) => t.status === 'running');
          if (!stillRunning) useOverviewStore.getState().processEnded('task_runner', 'completed');
        }, 500);
      },
    );

    const autoRunUn = listen(EventName.AUTO_RUN_COMPLETE, () => {
      // An auto-run touches many rows across many statuses — reload the world
      // once here rather than patching an unknown set.
      reloadRef.current();
      useOverviewStore.getState().processEnded('task_runner', 'completed');
    });

    return () => {
      if (countsTimer !== undefined) window.clearTimeout(countsTimer);
      outputUn.then((fn) => fn()).catch(silentCatch('useTaskQueue:unlisten-output'));
      statusUn.then((fn) => fn()).catch(silentCatch('useTaskQueue:unlisten-status'));
      completeUn.then((fn) => fn()).catch(silentCatch('useTaskQueue:unlisten-complete'));
      autoRunUn.then((fn) => fn()).catch(silentCatch('useTaskQueue:unlisten-autorun'));
    };
  }, []);

  const total = useMemo(
    () => TASK_STATUSES.reduce((acc, s) => acc + (counts[s] ?? 0), 0),
    [counts],
  );

  // Render from the store, not from `rows` — it carries the live patches.
  const storeTasks = useSystemStore((s) => s.tasks);

  return {
    tasks: storeTasks,
    counts,
    total,
    loading: list.loading,
    loadingMore: list.loadingMore,
    hasMore: list.hasMore,
    error: list.error,
    sentinelRef: list.sentinelRef,
    loadMore: list.loadMore,
    reload,
    refreshCounts,
    contextWarnings,
  };
}

export { normalizeStatus };
