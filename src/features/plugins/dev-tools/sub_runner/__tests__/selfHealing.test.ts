import { describe, expect, it } from 'vitest';
import type { DevTask } from '@/lib/bindings/DevTask';
import {
  analyzeFailure,
  failureEventKey,
  hiddenFailedCount,
  resolveFocusAction,
  selectAutoHealTargets,
  settleAttemptStatus,
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

/**
 * Sweep #388 — the panel and the focus handoff both read `store.tasks`, which
 * is the loaded 40-row window. L0 could report 12 failed while the panel showed
 * nothing, and a backlog handoff for a row past page 1 never fired.
 */
describe('settleAttemptStatus', () => {
  const child = (parent: string, status: string, attemptNo: number): DevTask =>
    ({ id: `${parent}-r${attemptNo}`, parent_task_id: parent, status, attempt: attemptNo }) as unknown as DevTask;

  it('stays healing while the retry row is queued, running or not yet loaded', () => {
    const a = attempt('t1', 1);
    expect(settleAttemptStatus(a, [])).toBe('healing');
    expect(settleAttemptStatus(a, [child('t1', 'queued', 2)])).toBe('healing');
    expect(settleAttemptStatus(a, [child('t1', 'running', 2)])).toBe('healing');
  });

  it('reports healed when the newest retry completed', () => {
    expect(settleAttemptStatus(attempt('t1', 1), [child('t1', 'completed', 2)])).toBe('healed');
  });

  it('reports failed when the newest retry failed or was cancelled', () => {
    expect(settleAttemptStatus(attempt('t1', 1), [child('t1', 'failed', 2)])).toBe('failed');
    expect(settleAttemptStatus(attempt('t1', 1), [child('t1', 'cancelled', 2)])).toBe('failed');
  });

  it('reads the newest child, not an older one, and ignores retries of other tasks', () => {
    const tasks = [child('t1', 'failed', 2), child('t1', 'completed', 3), child('other', 'failed', 9)];
    expect(settleAttemptStatus(attempt('t1', 2), tasks)).toBe('healed');
  });
});

describe('hiddenFailedCount', () => {
  it('returns null when the window already holds every failure', () => {
    expect(hiddenFailedCount(3, 3)).toBeNull();
    expect(hiddenFailedCount(3, 2)).toBeNull();
  });

  it('counts the failures the window never loaded', () => {
    expect(hiddenFailedCount(0, 12)).toBe(12);
    expect(hiddenFailedCount(5, 12)).toBe(7);
  });
});

describe('resolveFocusAction', () => {
  const win = [{ id: 'a', status: 'queued' }];

  it('does nothing without a pending id', () => {
    expect(resolveFocusAction(null, win, 'all').kind).toBe('idle');
  });

  it('rings the card when the row is already in the window', () => {
    expect(resolveFocusAction('a', win, 'all').kind).toBe('ready');
  });

  it('widens the filter when a concrete one is hiding the row', () => {
    expect(resolveFocusAction('zz', win, 'running').kind).toBe('switch-filter');
  });

  it('asks for more rows when the row is simply past page 1', () => {
    expect(resolveFocusAction('zz', win, 'all').kind).toBe('fetch');
  });
});
