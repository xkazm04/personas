import { useState, useCallback, useMemo } from 'react';
import {
  Heart, RefreshCw, AlertTriangle, XCircle,
  Lightbulb, ArrowRight, Shield,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import type { DevTask } from '@/lib/bindings/DevTask';

// ---------------------------------------------------------------------------
// Failure pattern analysis
// ---------------------------------------------------------------------------

interface FailurePattern {
  type: 'test_failure' | 'build_error' | 'timeout' | 'dependency' | 'permission' | 'unknown';
  label: string;
  icon: typeof AlertTriangle;
  color: string;
  autoFixable: boolean;
  suggestedAction: string;
}

const FAILURE_PATTERNS: { pattern: RegExp; result: Omit<FailurePattern, 'autoFixable'> & { autoFixable: boolean } }[] = [
  { pattern: /test.*fail|assertion.*error|expect.*receive/i, result: { type: 'test_failure', label: 'Test Failure', icon: XCircle, color: 'red', autoFixable: true, suggestedAction: 'Re-scan affected context and regenerate implementation with test constraints' } },
  { pattern: /compile.*error|build.*fail|syntax.*error|type.*error/i, result: { type: 'build_error', label: 'Build Error', icon: AlertTriangle, color: 'orange', autoFixable: true, suggestedAction: 'Analyze error output, fix syntax/type issues, retry build' } },
  { pattern: /timeout|timed?\s*out|deadline.*exceed/i, result: { type: 'timeout', label: 'Timeout', icon: RefreshCw, color: 'amber', autoFixable: false, suggestedAction: 'Increase timeout or break task into smaller units' } },
  { pattern: /dependency|package.*not found|module.*not found|import.*error/i, result: { type: 'dependency', label: 'Dependency Issue', icon: Shield, color: 'violet', autoFixable: true, suggestedAction: 'Install missing dependencies and retry' } },
  { pattern: /permission|access.*denied|forbidden|unauthorized/i, result: { type: 'permission', label: 'Permission Issue', icon: Shield, color: 'red', autoFixable: false, suggestedAction: 'Check credentials and access rights' } },
];

function analyzeFailure(task: DevTask): FailurePattern {
  const searchText = [task.error ?? '', task.description ?? '', task.title].join(' ');
  for (const { pattern, result } of FAILURE_PATTERNS) {
    if (pattern.test(searchText)) return result;
  }
  return { type: 'unknown', label: 'Unknown Failure', icon: AlertTriangle, color: 'primary', autoFixable: false, suggestedAction: 'Manual investigation required' };
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
  const tasks = useSystemStore((s) => s.tasks);
  const recordGoalSignal = useSystemStore((s) => s.recordGoalSignal);
  const addToast = useToastStore((s) => s.addToast);

  const [attempts, setAttempts] = useState<HealingAttempt[]>([]);
  const [autoHealEnabled, setAutoHealEnabled] = useState(false);

  const failedTasks = useMemo(() =>
    tasks.filter((t) => t.status === 'failed'),
  [tasks]);

  const analyzedFailures = useMemo(() =>
    failedTasks.map((t) => ({ task: t, pattern: analyzeFailure(t) })),
  [failedTasks]);

  const autoFixable = analyzedFailures.filter((f) => f.pattern.autoFixable);

  const handleHealTask = useCallback(async (task: DevTask, pattern: FailurePattern) => {
    const existing = attempts.find((a) => a.taskId === task.id);
    if (existing && existing.retryCount >= existing.maxRetries) {
      addToast(`Max retries reached for "${task.title}"`, 'error');
      return;
    }

    setAttempts((prev) => {
      const existing = prev.find((a) => a.taskId === task.id);
      if (existing) {
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
        `Self-healing: retrying "${task.title}" (${pattern.label})`);
    }

    onRetryTask(task.id);
  }, [attempts, addToast, onRetryTask, recordGoalSignal]);

  const handleHealAll = useCallback(async () => {
    for (const { task, pattern } of autoFixable) {
      await handleHealTask(task, pattern);
    }
  }, [autoFixable, handleHealTask]);

  if (failedTasks.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-500/15 bg-red-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-red-500/10">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-red-400" />
          <h3 className="text-md font-medium text-primary">Self-Healing</h3>
          <span className="rounded-full px-2 py-0.5 text-md font-medium bg-red-500/15 text-red-400 border border-red-500/25">
            {failedTasks.length} failed
          </span>
          {autoFixable.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-md font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25">
              {autoFixable.length} auto-fixable
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
            Auto-heal
          </label>
          {autoFixable.length > 0 && (
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={handleHealAll}
            >
              Heal All ({autoFixable.length})
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
              <Icon className={`w-4 h-4 text-${pattern.color}-400 flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className="text-md text-foreground truncate">{task.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-md text-foreground">{pattern.label}</span>
                  <ArrowRight className="w-3 h-3 text-foreground" />
                  <span className="text-md text-foreground">{pattern.suggestedAction}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {attempt && (
                  <span className={`text-md ${
                    attempt.status === 'healed' ? 'text-emerald-400' :
                    attempt.status === 'healing' ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {attempt.status === 'healing' ? `Retry ${attempt.retryCount}/${attempt.maxRetries}` :
                     attempt.status === 'healed' ? 'Healed' : `Failed (${attempt.retryCount}/${attempt.maxRetries})`}
                  </span>
                )}
                {pattern.autoFixable && (!attempt || attempt.retryCount < attempt.maxRetries) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Lightbulb className="w-3.5 h-3.5" />}
                    onClick={() => handleHealTask(task, pattern)}
                  >
                    Heal
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
