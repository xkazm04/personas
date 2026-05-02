import { useState, useCallback, useMemo } from 'react';
import {
  Heart, RefreshCw, AlertTriangle, XCircle,
  Lightbulb, ArrowRight, Shield,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import type { DevTask } from '@/lib/bindings/DevTask';

// ---------------------------------------------------------------------------
// Failure pattern analysis
// ---------------------------------------------------------------------------

type PatternColor = 'red' | 'orange' | 'amber' | 'violet' | 'primary';

// Static class bundles so Tailwind's JIT can detect every class at build time.
// `text-${color}-400` template strings are invisible to the JIT and silently
// produce no styles, so the failure-row icons stayed unstyled.
const PATTERN_ICON_CLASSES: Record<PatternColor, string> = {
  red:     'text-red-400',
  orange:  'text-orange-400',
  amber:   'text-amber-400',
  violet:  'text-violet-400',
  primary: 'text-primary',
};

type PatternLabelKey =
  | 'fp_test_failure_label' | 'fp_build_error_label' | 'fp_timeout_label'
  | 'fp_dependency_label' | 'fp_permission_label' | 'fp_unknown_label';
type PatternActionKey =
  | 'fp_test_failure_action' | 'fp_build_error_action' | 'fp_timeout_action'
  | 'fp_dependency_action' | 'fp_permission_action' | 'fp_unknown_action';

interface FailurePattern {
  type: 'test_failure' | 'build_error' | 'timeout' | 'dependency' | 'permission' | 'unknown';
  labelKey: PatternLabelKey;
  actionKey: PatternActionKey;
  icon: typeof AlertTriangle;
  color: PatternColor;
  autoFixable: boolean;
}

const FAILURE_PATTERNS: { pattern: RegExp; result: FailurePattern }[] = [
  { pattern: /test.*fail|assertion.*error|expect.*receive/i, result: { type: 'test_failure', labelKey: 'fp_test_failure_label', actionKey: 'fp_test_failure_action', icon: XCircle, color: 'red', autoFixable: true } },
  { pattern: /compile.*error|build.*fail|syntax.*error|type.*error/i, result: { type: 'build_error', labelKey: 'fp_build_error_label', actionKey: 'fp_build_error_action', icon: AlertTriangle, color: 'orange', autoFixable: true } },
  { pattern: /timeout|timed?\s*out|deadline.*exceed/i, result: { type: 'timeout', labelKey: 'fp_timeout_label', actionKey: 'fp_timeout_action', icon: RefreshCw, color: 'amber', autoFixable: false } },
  { pattern: /dependency|package.*not found|module.*not found|import.*error/i, result: { type: 'dependency', labelKey: 'fp_dependency_label', actionKey: 'fp_dependency_action', icon: Shield, color: 'violet', autoFixable: true } },
  { pattern: /permission|access.*denied|forbidden|unauthorized/i, result: { type: 'permission', labelKey: 'fp_permission_label', actionKey: 'fp_permission_action', icon: Shield, color: 'red', autoFixable: false } },
];

function analyzeFailure(task: DevTask): FailurePattern {
  const searchText = [task.error ?? '', task.description ?? '', task.title].join(' ');
  for (const { pattern, result } of FAILURE_PATTERNS) {
    if (pattern.test(searchText)) return result;
  }
  return { type: 'unknown', labelKey: 'fp_unknown_label', actionKey: 'fp_unknown_action', icon: AlertTriangle, color: 'primary', autoFixable: false };
}

// ---------------------------------------------------------------------------
// Healing attempt tracking
// ---------------------------------------------------------------------------

interface HealingAttempt {
  taskId: string;
  taskTitle: string;
  pattern: FailurePattern;
  status: 'pending' | 'healing' | 'healed' | 'failed';
  retryCount: number;
  maxRetries: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SelfHealingPanelProps {
  onRetryTask: (taskId: string) => void;
}

export function SelfHealingPanel({ onRetryTask }: SelfHealingPanelProps) {
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

  const handleHealAll = useCallback(async () => {
    for (const { task, pattern } of autoFixable) {
      await handleHealTask(task, pattern);
    }
  }, [autoFixable, handleHealTask]);

  if (failedTasks.length === 0) return null;

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
