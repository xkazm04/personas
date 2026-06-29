import { describe, it, expect } from 'vitest';
import { hasFailureSpike, fleetSuccessRatePct } from './fleetHealth';

// Both helpers take (completedExecutions, failedExecutions) and compute over the
// TERMINAL denominator (completed + failed). Running/cancelled rows are never
// passed in, so they cannot dilute the ratio.

describe('hasFailureSpike', () => {
  it('returns false when there are no terminal executions at all', () => {
    expect(hasFailureSpike(0, 0)).toBe(false);
  });

  it('returns false when nothing has finished yet (all in-flight: completed=0, failed=0)', () => {
    // 5 completed + 5 running upstream still only passes the terminal counts.
    expect(hasFailureSpike(0, 0)).toBe(false);
  });

  it('returns false below the minimum terminal sample size, even at 100% failure', () => {
    expect(hasFailureSpike(0, 2)).toBe(false); // terminal 2
    expect(hasFailureSpike(0, 1)).toBe(false); // terminal 1
    expect(hasFailureSpike(1, 1)).toBe(false); // terminal 2
  });

  it('fires at the minimum terminal sample size when most finished runs failed', () => {
    expect(hasFailureSpike(1, 2)).toBe(true); // terminal 3, ratio 0.66
    expect(hasFailureSpike(0, 3)).toBe(true); // terminal 3, ratio 1.0 — 3 failed + N running still fires
  });

  it('does not fire when failures are exactly half (threshold is strict >)', () => {
    expect(hasFailureSpike(3, 3)).toBe(false); // terminal 6, ratio 0.5
  });

  it('does not fire when fewer than half of finished runs failed', () => {
    expect(hasFailureSpike(6, 4)).toBe(false); // terminal 10, ratio 0.4
  });

  it('fires when more than half of finished runs failed on a healthy sample', () => {
    expect(hasFailureSpike(4, 6)).toBe(true); // terminal 10, ratio 0.6
  });

  it('does not count in-flight runs toward the denominator (5 completed, 0 failed = healthy)', () => {
    expect(hasFailureSpike(5, 0)).toBe(false);
  });

  it('handles a one-of-three failure case (terminal meets minimum, ratio does not)', () => {
    expect(hasFailureSpike(2, 1)).toBe(false); // terminal 3, ratio 0.33
  });
});

describe('fleetSuccessRatePct', () => {
  it('returns null when there are no terminal executions (no-data → neutral "—")', () => {
    expect(fleetSuccessRatePct(0, 0)).toBeNull();
  });

  it('reports 100% when every finished run succeeded, ignoring in-flight runs', () => {
    // 5 completed + 5 running upstream → caller passes (5, 0), not (5, total).
    expect(fleetSuccessRatePct(5, 0)).toBe(100);
  });

  it('reports 0% when every finished run failed', () => {
    expect(fleetSuccessRatePct(0, 5)).toBe(0);
  });

  it('computes the rate over the terminal denominator only', () => {
    expect(fleetSuccessRatePct(3, 1)).toBe(75); // 3 / 4
  });

  it('rounds to the nearest integer percentage', () => {
    expect(fleetSuccessRatePct(2, 1)).toBe(67); // 2 / 3 = 66.66 → 67
  });
});
