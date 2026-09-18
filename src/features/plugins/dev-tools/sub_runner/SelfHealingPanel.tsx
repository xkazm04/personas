import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Heart, RefreshCw, ArrowRight, Lightbulb } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import type { DevTask } from '@/lib/bindings/DevTask';
import {
  analyzeFailure,
  failureEventKey,
  hiddenFailedCount,
  selectAutoHealTargets,
  PATTERN_ICON_CLASSES,
  type FailurePattern,
  type HealingAttempt,
} from './selfHealing';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SelfHealingPanelProps {
  onRetryTask: (taskId: string) => void;
  /** L0 failed total for the whole project, not the loaded window. */
  totalFailed?: number;
  /** Widen the queue to the failed filter so the hidden rows load. */
  onShowFailed?: () => void;
  /** Every failed row, past the window, for Heal all. */
  fetchAllFailed?: () => Promise<DevTask[]>;
}

export function SelfHealingPanel({
  onRetryTask,
  totalFailed,
  onShowFailed,
  fetchAllFailed,
}: SelfHealingPanelProps) {
  const { t, tx } = useTranslation();
  const dr = t.plugins.dev_runner;
  const tasks = useSystemStore((s) => s.tasks);
  const recordGoalSignal = useSystemStore((s) => s.recordGoalSignal);
  const addToast = useToastStore((s) => s.addToast);

  const [attempts, setAttempts] = useState<HealingAttempt[]>([]);
  const [autoHealEnabled, setAutoHealEnabled] = useState(false);

  const failedTasks = useMemo(() =>
    tasks.filter((tk) => tk.status === 'failed'),
  [tasks]);

  const analyzedFailures = useMemo(() =>
    failedTasks.map((tk) => ({ task: tk, pattern: analyzeFailure(tk) })),
  [failedTasks]);

  const autoFixable = analyzedFailures.filter((f) => f.pattern.autoFixable);

  const handleHealTask = useCallback(async (task: DevTask, pattern: FailurePattern) => {
    const existing = attempts.find((a) => a.taskId === task.id);
    if (existing && existing.retryCount >= existing.maxRetries) {
      addToast(tx(dr.heal_max_retries, { title: task.title }), 'error');
      return;
    }

    setAttempts((prev) => {
      const existingAttempt = prev.find((a) => a.taskId === task.id);
      if (existingAttempt) {
        return prev.map((a) => a.taskId === task.id
          ? { ...a, status: 'healing' as const, retryCount: a.retryCount + 1 }
          : a);
      }
      return [...prev, {
        taskId: task.id,
        taskTitle: task.title,
        pattern,
        status: 'healing',
        retryCount: 1,
        maxRetries: 3,
      }];
    });

    // Record signal on goal if linked
    if (task.goal_id) {
      await recordGoalSignal(task.goal_id, 'auto_heal_attempt', undefined,
        tx(dr.heal_signal_log, { title: task.title, pattern: dr[pattern.labelKey] }));
    }

    onRetryTask(task.id);
  }, [attempts, addToast, onRetryTask, recordGoalSignal, dr, tx]);

  /**
   * Heal all works on the QUEUE, not the loaded window. `RunDeskControls`'
   * "Retry failed" already pulled the full failed set through `tasksPage`; the
   * panel healing only the first 40 rows meant the two buttons beside each
   * other disagreed about how many failures existed.
   */
  const handleHealAll = useCallback(async () => {
    let targets = autoFixable;
    if (fetchAllFailed) {
      try {
        const all = await fetchAllFailed();
        targets = all
          .map((task) => ({ task, pattern: analyzeFailure(task) }))
          .filter((f) => f.pattern.autoFixable);
      } catch (e) {
        // A failed widen must not silently become a window-only heal: fall back
        // and say so, rather than reporting a partial pass as a full one.
        silentCatch('SelfHealingPanel:fetchAllFailed')(e);
        addToast(dr.heal_all_window_only, 'error');
      }
    }
    for (const { task, pattern } of targets) {
      await handleHealTask(task, pattern);
    }
  }, [autoFixable, fetchAllFailed, handleHealTask, addToast, dr]);

  /** Failed rows the chips count that this window never loaded. */
  const hidden = hiddenFailedCount(failedTasks.length, totalFailed ?? failedTasks.length);

  /**
   * Auto-heal. The checkbox used to be `useState(false)` read by nothing but
   * itself: the label asserted a behaviour the code did not have, which is the
   * one thing worse than not offering it.
   *
   * Session-only by design (not persisted until an operator asks for it), and
   * it runs the SAME `handleHealTask` the button does, so the max-retries
   * ceiling and the goal signal are not bypassed. `dispatchedRef` keys on the
   * failure EVENT rather than the task, so a fresh failure of an already-healed
   * task is retried once, and toggling the switch is not a way to re-fire an
   * old one.
   */
  const dispatchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoHealEnabled) return;
    const targets = selectAutoHealTargets(analyzedFailures, attempts, dispatchedRef.current);
    for (const { task, pattern } of targets) {
      dispatchedRef.current.add(failureEventKey(task));
      void handleHealTask(task, pattern);
    }
  }, [autoHealEnabled, analyzedFailures, attempts, handleHealTask]);

  // A window with no failed rows is NOT proof there are none: with the queue
  // filtered to `running`, 12 failures could sit one page away while this panel
  // rendered nothing at all.
  if (failedTasks.length === 0) {
    if (hidden === null || !onShowFailed) return null;
    return (
      <div className="rounded-modal border border-red-500/15 bg-red-500/5 px-4 py-3 flex items-center gap-2">
        <Heart className="w-4 h-4 text-red-400 shrink-0" />
        <span className="text-md text-foreground">{tx(dr.heal_hidden_failed, { count: hidden })}</span>
        <Button variant="ghost" size="sm" onClick={onShowFailed} data-testid="self-healing-show-hidden">
          {dr.heal_show_failed}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-modal border border-red-500/15 bg-red-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-red-500/10">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-red-400" />
          <h3 className="text-md font-medium text-primary">{t.plugins.dev_runner.self_healing}</h3>
          <span className="rounded-full px-2 py-0.5 text-md font-medium bg-red-500/15 text-red-400 border border-red-500/25">
            {tx(dr.heal_chip_failed, { count: failedTasks.length })}
          </span>
          {autoFixable.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-md font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25">
              {tx(dr.heal_chip_auto_fixable, { count: autoFixable.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-md text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoHealEnabled}
              onChange={(e) => setAutoHealEnabled(e.target.checked)}
              data-testid="self-healing-auto"
              aria-label={t.plugins.dev_runner.auto_heal}
              className="rounded"
            />
            {t.plugins.dev_runner.auto_heal}
          </label>
          {autoFixable.length > 0 && (
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={handleHealAll}
            >
              {t.plugins.dev_runner.heal_all}({autoFixable.length})
            </Button>
          )}
        </div>
      </div>

      {/* Failure list */}
      <div className="divide-y divide-red-500/5">
        {analyzedFailures.map(({ task, pattern }) => {
          const Icon = pattern.icon;
          const attempt = attempts.find((a) => a.taskId === task.id);
          return (
            <div key={task.id} className="flex items-center gap-3 px-4 py-3">
              <Icon className={`w-4 h-4 ${PATTERN_ICON_CLASSES[pattern.color]} flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className="text-md text-foreground truncate">{task.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-md text-foreground">{dr[pattern.labelKey]}</span>
                  <ArrowRight className="w-3 h-3 text-foreground" />
                  <span className="text-md text-foreground">{dr[pattern.actionKey]}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {attempt && (
                  <span className={`text-md ${
                    attempt.status === 'healed' ? 'text-emerald-400' :
                    attempt.status === 'healing' ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {attempt.status === 'healing' ? tx(dr.heal_status_retrying, { retry: attempt.retryCount, max: attempt.maxRetries }) :
                     attempt.status === 'healed' ? dr.heal_status_healed :
                     tx(dr.heal_status_failed, { retry: attempt.retryCount, max: attempt.maxRetries })}
                  </span>
                )}
                {pattern.autoFixable && (!attempt || attempt.retryCount < attempt.maxRetries) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Lightbulb className="w-3.5 h-3.5" />}
                    onClick={() => handleHealTask(task, pattern)}
                  >
                    {dr.heal_btn}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
