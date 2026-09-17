// Failure classification + the auto-heal selection rule, lifted out of
// SelfHealingPanel so both are testable without mounting the panel (and so the
// component stays near the 200-LOC line).
import { AlertTriangle, RefreshCw, Shield, XCircle } from 'lucide-react';
import type { DevTask } from '@/lib/bindings/DevTask';

export type PatternColor = 'red' | 'orange' | 'amber' | 'violet' | 'primary';

// Static class bundles so Tailwind's JIT can detect every class at build time.
// `text-${color}-400` template strings are invisible to the JIT and silently
// produce no styles, so the failure-row icons stayed unstyled.
export const PATTERN_ICON_CLASSES: Record<PatternColor, string> = {
  red: 'text-red-400',
  orange: 'text-orange-400',
  amber: 'text-amber-400',
  violet: 'text-violet-400',
  primary: 'text-primary',
};

export type PatternLabelKey =
  | 'fp_test_failure_label' | 'fp_build_error_label' | 'fp_timeout_label'
  | 'fp_dependency_label' | 'fp_permission_label' | 'fp_unknown_label';
export type PatternActionKey =
  | 'fp_test_failure_action' | 'fp_build_error_action' | 'fp_timeout_action'
  | 'fp_dependency_action' | 'fp_permission_action' | 'fp_unknown_action';

export interface FailurePattern {
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

export function analyzeFailure(task: DevTask): FailurePattern {
  const searchText = [task.error ?? '', task.description ?? '', task.title].join(' ');
  for (const { pattern, result } of FAILURE_PATTERNS) {
    if (pattern.test(searchText)) return result;
  }
  return { type: 'unknown', labelKey: 'fp_unknown_label', actionKey: 'fp_unknown_action', icon: AlertTriangle, color: 'primary', autoFixable: false };
}

export interface HealingAttempt {
  taskId: string;
  taskTitle: string;
  pattern: FailurePattern;
  status: 'pending' | 'healing' | 'healed' | 'failed';
  retryCount: number;
  maxRetries: number;
}

export interface AnalyzedFailure {
  task: DevTask;
  pattern: FailurePattern;
}

/**
 * Identity of one FAILURE EVENT, not of the task.
 *
 * A task that fails, gets retried, and fails again is a new thing to heal even
 * though the row id is unchanged. `updated_at` moves on every repo write, so it
 * is the cheapest available event stamp; a row from before the
 * `dev_tasks_updated_at` migration has none, and then the task id alone is the
 * key — which errs toward healing once rather than repeatedly.
 */
export function failureEventKey(task: DevTask): string {
  return `${task.id}:${task.updated_at ?? ''}`;
}

/**
 * Which failures the Auto-heal switch should retry on its own.
 *
 * The switch used to be `useState(false)` read by nothing but its own checkbox:
 * it asserted a behaviour the code did not have, which is worse than not
 * offering it. This is that behaviour, stated as a rule so it can be gated.
 *
 * @param dispatched failure-event keys this session already auto-healed. The
 *   caller owns it (a ref), so toggling the switch off and on does not re-fire
 *   for failures the operator has already seen retried.
 */
export function selectAutoHealTargets(
  failures: readonly AnalyzedFailure[],
  attempts: readonly HealingAttempt[],
  dispatched: ReadonlySet<string>,
): AnalyzedFailure[] {
  return failures.filter((f) => {
    if (!f.pattern.autoFixable) return false;
    if (dispatched.has(failureEventKey(f.task))) return false;
    // The max-retries ceiling is the manual path's, and auto-heal must not be a
    // way around it: past the cap the operator gets the toast, not a fourth run.
    const attempt = attempts.find((a) => a.taskId === f.task.id);
    if (attempt && attempt.retryCount >= attempt.maxRetries) return false;
    return true;
  });
}
