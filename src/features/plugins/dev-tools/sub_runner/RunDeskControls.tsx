import { useCallback, useState } from 'react';
import { Play, Plus, ListChecks, XCircle, RotateCcw, Minus, Infinity as InfinityIcon } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import { mapWithConcurrency } from '@/lib/concurrency';
import { toastCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import type { TaskCounts } from './useTaskQueue';

/** How many rows a bulk action (start/cancel/retry) may pull in one sweep. */
const BULK_LIMIT = 200;

/** "Cancel all" can target up to BULK_LIMIT rows at once, and each
 *  cancelTaskExecution IPC call competes with the live task-list channel for
 *  the same IPC bridge. This bounds the burst so a 200-row cancel doesn't
 *  starve the UI that's showing the user their tasks disappearing. Halving
 *  this (~7-8) would make a large cancel-all visibly slower to settle;
 *  doubling it (~30) risks the exact IPC-bridge contention this exists to
 *  avoid — most real queues are nowhere near BULK_LIMIT anyway. */
const CANCEL_ALL_CONCURRENCY = 15;

/** Bounds for the concurrency stepper — mirrors the executor's own clamp. */
const MIN_PARALLEL = 1;
const MAX_PARALLEL = 8;

export interface RunDeskControlsProps {
  projectId?: string;
  counts: TaskCounts;
  onNewTask: () => void;
  /** Reload the queue after a bulk mutation the live events don't cover. */
  onMutated: () => void;
  /** Called after an auto-run is started so the banner rehydrates at once. */
  onAutoRunStarted: () => void;
}

/**
 * The Run Desk action bar.
 *
 * Every bulk action resolves its own target rows from the backend
 * (`tasksPage` with a status filter) instead of the loaded window — the old
 * runner operated on `store.tasks`, which after pagination is only the first
 * 40 rows, so "Start batch" silently skipped the rest of the queue.
 */
export function RunDeskControls({
  projectId,
  counts,
  onNewTask,
  onMutated,
  onAutoRunStarted,
}: RunDeskControlsProps) {
  const { t, tx } = useTranslation();
  const dr = t.plugins.dev_runner;
  const { batchFromAcceptedIdeas } = useDevToolsActions();
  const maxParallelTasks = useSystemStore((s) => s.maxParallelTasks);
  const setMaxParallelTasks = useSystemStore((s) => s.setMaxParallelTasks);
  const [busy, setBusy] = useState<string | null>(null);

  const queued = counts.queued ?? 0;
  const running = counts.running ?? 0;
  const failed = counts.failed ?? 0;

  const fetchIds = useCallback(
    async (statuses: string[]) => {
      const page = await devApi.tasksPage(projectId, statuses, BULK_LIMIT);
      return page.tasks.map((task) => task.id);
    },
    [projectId],
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<void>, errorMessage: string) => {
      setBusy(key);
      try {
        await fn();
        onMutated();
      } catch (e) {
        toastCatch(`RunDeskControls:${key}`, errorMessage)(e);
      } finally {
        setBusy(null);
      }
    },
    [onMutated],
  );

  const handleBatchFromAccepted = useCallback(
    () => run('accepted', () => batchFromAcceptedIdeas(), dr.batch_from_accepted_error),
    [run, batchFromAcceptedIdeas, dr],
  );

  const handleStartBatch = useCallback(
    () =>
      run(
        'start',
        async () => {
          const ids = await fetchIds(['queued']);
          if (ids.length === 0) return;
          await useSystemStore.getState().startBatch(ids);
          useOverviewStore.getState().processStarted('task_runner', undefined, 'Run Desk Batch');
        },
        dr.start_batch_error,
      ),
    [run, fetchIds, dr],
  );

  const handleAutoRun = useCallback(
    () =>
      run(
        'auto',
        async () => {
          if (!projectId) return;
          await devApi.startAutoRun(projectId, maxParallelTasks);
          useOverviewStore.getState().processStarted('task_runner', undefined, 'Auto-Run');
          onAutoRunStarted();
        },
        dr.auto_run_started,
      ),
    [run, projectId, maxParallelTasks, onAutoRunStarted, dr],
  );

  /**
   * Bulk retry. Goes through `dev_tools_retry_task`, which copies the title
   * verbatim and records lineage in `parent_task_id`/`attempt` — the old path
   * created a fresh task with a `[Retry] ` prefix, so a twice-retried task
   * ended up titled `[Retry] [Retry] …` with no link to its origin.
   */
  const handleRetryFailed = useCallback(
    () =>
      run(
        'retry',
        async () => {
          const ids = await fetchIds(['failed']);
          for (const id of ids) await devApi.retryTask(id);
        },
        dr.retry_failed_error,
      ),
    [run, fetchIds, dr],
  );

  const handleCancelAll = useCallback(
    () =>
      run(
        'cancel',
        async () => {
          const ids = await fetchIds(['running', 'queued']);
          await mapWithConcurrency(ids, CANCEL_ALL_CONCURRENCY, (id) => devApi.cancelTaskExecution(id));
        },
        dr.cancel_all_error,
      ),
    [run, fetchIds, dr],
  );

  return (
    <ActionRow>
      <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNewTask}>
        {dr.new_task}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<ListChecks className="w-3.5 h-3.5" />}
        loading={busy === 'accepted'}
        onClick={handleBatchFromAccepted}
      >
        {dr.batch_from_accepted}
      </Button>
      <Button
        variant="accent"
        accentColor="amber"
        size="sm"
        icon={<Play className="w-3.5 h-3.5" />}
        disabled={queued === 0}
        loading={busy === 'start'}
        onClick={handleStartBatch}
      >
        {dr.start_batch}
      </Button>
      <Button
        variant="accent"
        accentColor="violet"
        size="sm"
        icon={<InfinityIcon className="w-3.5 h-3.5" />}
        disabled={!projectId || queued === 0}
        loading={busy === 'auto'}
        onClick={handleAutoRun}
      >
        {dr.auto_run_all}
      </Button>
      {failed > 0 && (
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          loading={busy === 'retry'}
          onClick={handleRetryFailed}
        >
          {tx(dr.retry_failed_count, { count: failed })}
        </Button>
      )}
      <Button
        variant="danger"
        size="sm"
        icon={<XCircle className="w-3.5 h-3.5" />}
        disabled={running === 0 && queued === 0}
        loading={busy === 'cancel'}
        onClick={handleCancelAll}
      >
        {dr.cancel_all}
      </Button>

      {/* Concurrency stepper — `maxParallelTasks` existed in the slice but had
          no UI, so the value could only ever be its default. */}
      <Tooltip content={dr.concurrency_hint}>
        <div className="flex items-center gap-1.5 ml-auto rounded-interactive border border-primary/10 bg-secondary/30 px-2 py-1">
          <span className="typo-caption text-foreground">{dr.concurrency}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={dr.concurrency_decrease}
            disabled={maxParallelTasks <= MIN_PARALLEL}
            onClick={() => setMaxParallelTasks(Math.max(MIN_PARALLEL, maxParallelTasks - 1))}
          >
            <Minus className="w-3 h-3" />
          </Button>
          <span className="typo-caption font-medium tabular-nums w-4 text-center">{maxParallelTasks}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={dr.concurrency_increase}
            disabled={maxParallelTasks >= MAX_PARALLEL}
            onClick={() => setMaxParallelTasks(Math.min(MAX_PARALLEL, maxParallelTasks + 1))}
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      </Tooltip>
    </ActionRow>
  );
}
