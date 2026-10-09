import { describe, expect, it } from 'vitest';

import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import type { LifecycleRunOutcome } from '@/lib/bindings/LifecycleRunOutcome';

import { flakyRuns, slowGateItem, slowingRuns } from '../../../../journey/__tests__/gateFixtures';
import { run } from '../../../../journey/__tests__/detailFixtures';
import { FLAKY_WINDOW, SLOWING, filedSlowItem, flakyOf, signalsOf, slowingOf } from '../signals';

const series = (outcomes: LifecycleRunOutcome[], ms = 10_000): LifecycleRun[] => outcomes.map((o) => run('x', 'lint', o, ms));
const times = (ms: number[]): LifecycleRun[] => ms.map((d) => run('x', 'typecheck', 'passed', d));

describe('flaky', () => {
  it('flags a command whose outcome flips 3+ times in its last 10 answered runs', () => {
    const f = flakyOf(flakyRuns());
    expect(f).not.toBeNull();
    expect(f!.flips).toBe(4);
    expect(f!.passes).toBe(4);
    expect(f!.failures).toBe(6);
    // Oldest first: the drawing order.
    expect(f!.window[f!.window.length - 1]).toBe('failed');
  });

  it('needs both passes and failures, and at least 3 flips', () => {
    expect(flakyOf(series(['passed', 'passed', 'passed', 'passed']))).toBeNull();
    expect(flakyOf(series(['failed', 'passed', 'failed']))).toBeNull(); // 2 flips
    expect(flakyOf(series(['failed', 'passed', 'failed', 'passed']))?.flips).toBe(3);
  });

  it('does not count a run that never answered, and looks only at the newest 10 answered', () => {
    // A timeout or a non-run between two passes is not a flip.
    expect(flakyOf(series(['passed', 'timeout', 'passed', 'did_not_run', 'passed', 'failed']))).toBeNull();
    // Flips older than the window do not count.
    const steady = series(Array.from({ length: FLAKY_WINDOW }, () => 'passed' as const));
    const old = series(['failed', 'passed', 'failed', 'passed']);
    expect(flakyOf([...steady, ...old])).toBeNull();
  });
});

describe('slowing (the slow-gate regression rule)', () => {
  it('flags a recent mean above 1.3x the prior median, with its evidence', () => {
    const s = slowingOf(slowingRuns());
    expect(s).not.toBeNull();
    expect(s!.recentMeanMs).toBeCloseTo(80_333, 0);
    expect(s!.priorMedianMs).toBe(50_000);
    expect(s!.recentRuns).toBe(SLOWING.recentRuns);
    expect(s!.priorRuns).toBe(6);
  });

  it('needs at least 5 prior answered runs (edge: 4 prior is never slowing)', () => {
    expect(slowingOf(times([90_000, 90_000, 90_000, 10_000, 10_000, 10_000, 10_000]))).toBeNull();
    expect(slowingOf(times([90_000, 90_000, 90_000, 10_000, 10_000, 10_000, 10_000, 10_000]))).not.toBeNull();
    expect(slowingOf(times([90_000]))).toBeNull();
    expect(slowingOf([])).toBeNull();
  });

  it('is strict at the factor, and ignores runs with no honest duration', () => {
    // Recent mean exactly 1.3x: not slowing.
    expect(slowingOf(times([13_000, 13_000, 13_000, 10_000, 10_000, 10_000, 10_000, 10_000]))).toBeNull();
    const withStubs = [run('x', 'typecheck', 'timeout', 999_999), ...times([30_000, 30_000, 30_000, 10_000, 10_000, 10_000, 10_000, 10_000])];
    expect(slowingOf(withStubs)?.recentMeanMs).toBe(30_000);
  });
});

describe('filed slow-gate item', () => {
  it('finds an open slow-gate item for the command only', () => {
    const item = slowGateItem();
    expect(filedSlowItem([item], 'tsc')).toBe(item);
    expect(filedSlowItem([item], 'eslint')).toBeNull();
    expect(filedSlowItem([{ ...item, status: 'delivered' }], 'tsc')).toBeNull();
    expect(filedSlowItem([{ ...item, source: 'overseer' }], 'tsc')).toBeNull();
    expect(signalsOf(slowingRuns(), [item], 'tsc').filed).toBe(item);
  });
});
