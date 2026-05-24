import { describe, it, expect } from 'vitest';
import { hasFailureSpike } from './fleetHealth';

describe('hasFailureSpike', () => {
  it('returns false when there are no executions at all', () => {
    expect(hasFailureSpike(0, 0)).toBe(false);
  });

  it('returns false below the minimum sample size, even at 100% failure', () => {
    expect(hasFailureSpike(2, 2)).toBe(false);
    expect(hasFailureSpike(1, 1)).toBe(false);
  });

  it('fires at the minimum sample size when most runs failed', () => {
    expect(hasFailureSpike(3, 2)).toBe(true);
    expect(hasFailureSpike(3, 3)).toBe(true);
  });

  it('does not fire when failures are exactly half (threshold is strict >)', () => {
    expect(hasFailureSpike(6, 3)).toBe(false);
  });

  it('does not fire when fewer than half failed', () => {
    expect(hasFailureSpike(10, 4)).toBe(false);
  });

  it('fires when more than half failed on a healthy sample', () => {
    expect(hasFailureSpike(10, 6)).toBe(true);
  });

  it('handles a one-of-three failure case (sample meets minimum, ratio does not)', () => {
    expect(hasFailureSpike(3, 1)).toBe(false);
  });
});
