import { describe, expect, it } from 'vitest';
import type { DevTask } from '@/lib/bindings/DevTask';
import {
  analyzeFailure,
  failureEventKey,
  selectAutoHealTargets,
  type AnalyzedFailure,
  type HealingAttempt,
} from '../selfHealing';

/**
 * Sweep #387 — the Auto-heal checkbox was `useState(false)` read by nothing but
 * its own input. The label asserted a behaviour the code did not have. This
 * gates the rule that now backs it.
 */

const task = (id: string, error: string, updatedAt = '2026-09-17T10:00:00Z'): DevTask =>
  ({
    id,
    title: `task ${id}`,
    description: null,
    error,
    status: 'failed',
    updated_at: updatedAt,
  }) as unknown as DevTask;

const analyzed = (t: DevTask): AnalyzedFailure => ({ task: t, pattern: analyzeFailure(t) });

const attempt = (taskId: string, retryCount: number, maxRetries = 3): HealingAttempt => ({
  taskId,
  taskTitle: taskId,
  pattern: analyzeFailure(task(taskId, 'test failed')),
  status: 'healing',
  retryCount,
  maxRetries,
});

describe('analyzeFailure', () => {
  it('marks a test failure auto-fixable and a permission failure not', () => {
    expect(analyzeFailure(task('a', 'test failed: assertion error')).autoFixable).toBe(true);
    expect(analyzeFailure(task('b', 'permission denied')).autoFixable).toBe(false);
  });
});

describe('selectAutoHealTargets', () => {
  it('picks up a newly arrived auto-fixable failure', () => {
    const targets = selectAutoHealTargets([analyzed(task('a', 'test failed'))], [], new Set());
    expect(targets.map((t) => t.task.id)).toEqual(['a']);
  });

  it('ignores a failure the operator can only fix by hand', () => {
    const targets = selectAutoHealTargets([analyzed(task('b', 'access denied'))], [], new Set());
    expect(targets).toEqual([]);
  });

  it('does not dispatch the same failure event twice', () => {
    const t = task('a', 'test failed');
    const dispatched = new Set([failureEventKey(t)]);
    expect(selectAutoHealTargets([analyzed(t)], [], dispatched)).toEqual([]);
  });

  it('treats a FRESH failure of the same task as a new event', () => {
    const first = task('a', 'test failed', '2026-09-17T10:00:00Z');
    const again = task('a', 'test failed', '2026-09-17T11:00:00Z');
    const dispatched = new Set([failureEventKey(first)]);
    expect(selectAutoHealTargets([analyzed(again)], [], dispatched).map((t) => t.task.id)).toEqual(['a']);
  });

  it('stops at the max-retries ceiling the manual path uses', () => {
    const t = task('a', 'test failed');
    expect(selectAutoHealTargets([analyzed(t)], [attempt('a', 3)], new Set())).toEqual([]);
    expect(selectAutoHealTargets([analyzed(t)], [attempt('a', 2)], new Set())).toHaveLength(1);
  });
});
