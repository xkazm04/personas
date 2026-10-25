// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fleetSuccessRatePct } from './fleetHealth';

// The helper takes (completedExecutions, failedExecutions) and computes over the
// TERMINAL denominator (completed + failed). Running/cancelled rows are never
// passed in, so they cannot dilute the ratio.

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
