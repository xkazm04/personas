import { describe, it, expect } from 'vitest';
import { trustPercent } from '../personaStats';

describe('trustPercent — trust-score display guard', () => {
  // A genuine 0–1 ratio scales up to a percentage.
  it('scales a genuine ratio', () => {
    expect(trustPercent(0.83)).toEqual({ pct: 83, overflow: false });
    expect(trustPercent(1)).toEqual({ pct: 100, overflow: false });
    expect(trustPercent(0)).toEqual({ pct: 0, overflow: false });
  });

  // A stale/legacy spec that stored the score already-scaled as a percent
  // (e.g. 83 instead of 0.83) must NOT be multiplied by 100 again.
  it('does not double-scale a value already expressed as a percent', () => {
    expect(trustPercent(83)).toEqual({ pct: 83, overflow: false });
  });

  // The live smoke case: 83.11 double-scaled to "8311%". Passing the raw
  // out-of-range value clamps to 100 and flags the overflow for the tooltip.
  it('clamps an out-of-range value and flags the overflow', () => {
    expect(trustPercent(8311)).toEqual({ pct: 100, overflow: true });
    expect(trustPercent(101)).toEqual({ pct: 100, overflow: true });
  });

  // Corrupt inputs floor to zero rather than rendering NaN%.
  it('floors non-finite and negative inputs to zero', () => {
    expect(trustPercent(Number.NaN)).toEqual({ pct: 0, overflow: false });
    expect(trustPercent(Number.POSITIVE_INFINITY)).toEqual({ pct: 0, overflow: false });
    expect(trustPercent(-0.5)).toEqual({ pct: 0, overflow: false });
  });
});
