import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Plus, ListChecks } from 'lucide-react';
import { ContentBox, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DevToolsPageHeader } from '../DevToolsPageHeader';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { toastCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { SelfHealingPanel } from './SelfHealingPanel';
import { TaskCard, StatusBadge } from './TaskCard';
import { TaskModal, type TaskDraft } from './TaskModal';
import { AutoRunBanner } from './AutoRunBanner';
import { RunDeskControls } from './RunDeskControls';
import {
  useTaskQueue, normalizeStatus, TASK_STATUSES,
  type TaskStatus, type TaskStatusFilter,
} from './useTaskQueue';
import type { DevTask } from '@/lib/bindings/DevTask';

/** Cluster the loaded window so running/queued/failed/done group visually. */
const STATUS_ORDER: TaskStatus[] = ['running', 'queued', 'failed', 'completed', 'cancelled'];

/**
 * Run Desk — the single execution surface for dispatched work.
 *
 * Replaces the old Task Runner. What changed, and why:
 * - **Paged.** `useTaskQueue` layers L0 counts / a 40-row keyset page / a
 *   scroll sentinel, so the page no longer materializes every task ever run.
 * - **Event-driven.** Status/complete events patch one row instead of
 *   refetching the whole project on every tick.
 * - **Honest progress.** The invented phase mapping is gone; a card shows the
 *   real progress %, the real status token, and the last streamed line.
 * - **Durable auto-run.** The banner rehydrates from `dev_auto_runs`.
 * - **Real retry lineage.** `dev_tools_retry_task` + an attempt chip replace
 *   the `[Retry] ` title mutation.
 */
export default function RunDeskPage() {
  const { t, tx } = useTranslation();
  const dr = t.plugins.dev_runner;
  const { createTask, batchFromAcceptedIdeas } = useDevToolsActions();

  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const fetchIdeas = useSystemStore((s) => s.fetchIdeas);
  const projectId = activeProjectId ?? undefined;

  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all');
  const [showModal, setShowModal] = useState(false);
  const [autoRunToken, setAutoRunToken] = useState(0);

  const queue = useTaskQueue({ projectId, statusFilter });
  const { tasks, counts, total, reload } = queue;

  // Ideas power the source-idea provenance chips on cards.
  useEffect(() => {
    if (projectId) fetchIdeas(projectId);
  }, [projectId, fetchIdeas]);

  // --- pendingTaskFocusId handoff (dispatch-from-backlog / goal spotlight) --
  // Capture into local state, clear from the store immediately, then wait
  // until the matching card exists before scrolling + ringing it.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  useEffect(() => {
    const id = useSystemStore.getState().pendingTaskFocusId;
    if (id) {
      setPendingFocusId(id);
      useSystemStore.getState().setPendingTaskFocusId(null);
    }
  }, []);
  useEffect(() => {
    if (!pendingFocusId) return;
    const el = document.querySelector<HTMLElement>(`[data-task-id="${pendingFocusId}"]`);
    if (!el) return; // Card hasn't rendered yet; wait for the next tasks update.
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary/60');
    const timer = window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary/60'), 2000);
    setPendingFocusId(null);
    return () => window.clearTimeout(timer);
  }, [pendingFocusId, tasks.length]);

  // --- Row actions ------------------------------------------------------
  const handleRetry = useCallback(
    (task: DevTask) => {
      devApi
        .retryTask(task.id)
        .then(() => reload())
        .catch(toastCatch('RunDeskPage:retryTask', dr.retry_failed_error));
    },
    [reload, dr],
  );

  const handleCancel = useCallback(
    (task: DevTask) => {
      devApi
        .cancelTaskExecution(task.id)
        .then(() => reload())
        .catch(toastCatch('RunDeskPage:cancelTask', dr.cancel_all_error));
    },
    [reload, dr],
  );

  const handleCreateTask = useCallback(
    (data: TaskDraft) => {
      Promise.resolve(createTask(data))
        .then(() => reload())
        .catch(toastCatch('RunDeskPage:createTask'));
    },
    [createTask, reload],
  );

  // --- Derived view state ----------------------------------------------
  const tasksByStatus = useMemo(
    () =>
      tasks.reduce((acc, task) => {
        (acc[normalizeStatus(task.status)] ??= []).push(task);
        return acc;
      }, {} as Partial<Record<TaskStatus, DevTask[]>>),
    [tasks],
  );

  // Parent titles for retry chips, resolved from the loaded window only.
  const titleById = useMemo(() => new Map(tasks.map((task) => [task.id, task.title])), [tasks]);

  const settled = (counts.completed ?? 0) + (counts.failed ?? 0) + (counts.cancelled ?? 0);
  const overallProgress = total > 0 ? (settled / total) * 100 : 0;

  const filters: TaskStatusFilter[] = useMemo(() => ['all', ...TASK_STATUSES], []);

  return (
    <ContentBox>
      <DevToolsPageHeader
        icon={Play}
        title={dr.run_desk_title}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        <RunDeskControls
          projectId={projectId}
          counts={counts}
          onNewTask={() => setShowModal(true)}
          onMutated={reload}
          onAutoRunStarted={() => setAutoRunToken((n) => n + 1)}
        />

        <AutoRunBanner projectId={projectId} refreshToken={autoRunToken} onRunFinished={reload} />

        <div className="space-y-5">
          {/* Status filter chips — fed by L0 counts, so they stay truthful
              beyond the loaded page. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {filters.map((f) => {
              const count = f === 'all' ? total : counts[f] ?? 0;
              const active = statusFilter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 typo-caption border transition-colors ${
                    active
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-secondary/30 text-foreground border-primary/10 hover:border-primary/20'
                  }`}
                >
                  {f === 'all' ? t.common.all : tokenLabel(t, 'execution', f)}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Queue progress — derived from project-wide counts, not from the
              average of the loaded page. */}
          {total > 0 && (
            <div className="border border-primary/10 rounded-modal p-4 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="typo-section-title">{dr.batch_progress}</h3>
                <div className="flex items-center gap-3 text-[10px] text-foreground">
                  {STATUS_ORDER.map((s) =>
                    (counts[s] ?? 0) > 0 ? (
                      <span key={s} className="tabular-nums">
                        {counts[s]} {tokenLabel(t, 'execution', s)}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
              <div className="w-full h-2 bg-primary/10 rounded-full overflow-hidden">
                <div className="animate-fade-in h-full bg-amber-400 rounded-full" style={{ width: `${overallProgress}%` }} />
              </div>
              <p className="text-[10px] text-foreground mt-1.5 text-right">
                {Math.round(overallProgress)}{dr.percent_overall}
              </p>
            </div>
          )}

          {/* Self-healing panel — reads the failed rows in the loaded window */}
          <SelfHealingPanel onRetryTask={(taskId) => {
            devApi
              .retryTask(taskId)
              .then(() => reload())
              .catch(toastCatch('RunDeskPage:healRetry', dr.retry_failed_error));
          }} />

          <div>
            <h3 className="typo-label font-semibold uppercase tracking-wider text-primary mb-3">
              {tx(dr.task_queue_count, { count: total })}
            </h3>

            {queue.loading ? (
              <div className="flex justify-center py-16">
                <LoadingSpinner size="sm" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-primary/10 rounded-modal">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <Play className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="text-md text-foreground mb-1">{dr.no_tasks_queued}</p>
                <p className="text-md text-foreground mb-4">{dr.no_tasks_queued_sub}</p>
                <div className="flex justify-center gap-2">
                  <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowModal(true)}>
                    {dr.new_task}
                  </Button>
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    icon={<ListChecks className="w-3.5 h-3.5" />}
                    onClick={() => {
                      Promise.resolve(batchFromAcceptedIdeas())
                        .then(() => reload())
                        .catch(toastCatch('RunDeskPage:batchFromAccepted', dr.batch_from_accepted_error));
                    }}
                  >
                    {dr.batch_from_accepted}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {STATUS_ORDER.map((status) => {
                  const group = tasksByStatus[status];
                  if (!group || group.length === 0) return null;
                  return (
                    <div key={status} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={status} />
                        <span className="text-[10px] text-foreground tabular-nums">{group.length}</span>
                      </div>
                      {group.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          contextWarnings={queue.contextWarnings[task.id]}
                          parentTitle={task.parent_task_id ? titleById.get(task.parent_task_id) ?? null : null}
                          onRetry={handleRetry}
                          onCancel={handleCancel}
                        />
                      ))}
                    </div>
                  );
                })}

                {/* L2 sentinel */}
                {queue.hasMore && (
                  <div ref={queue.sentinelRef} className="py-3 flex items-center justify-center">
                    {queue.loadingMore ? (
                      <LoadingSpinner size="xs" />
                    ) : (
                      <Button variant="ghost" size="sm" onClick={queue.loadMore}>
                        {dr.load_more}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ContentBody>

      <TaskModal open={showModal} onClose={() => setShowModal(false)} onCreate={handleCreateTask} />
    </ContentBox>
  );
}
