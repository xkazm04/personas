import { describe, expect, it } from 'vitest';
import { normalizeProgress } from '../useMediaExport';

describe('normalizeProgress', () => {
  it('returns 0 for non-finite input', () => {
    expect(normalizeProgress(Number.NaN)).toBe(0);
    expect(normalizeProgress(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeProgress(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('returns 0 for zero or negative input', () => {
    expect(normalizeProgress(0)).toBe(0);
    expect(normalizeProgress(-1)).toBe(0);
  });

  it('passes through 0–1 fractions unchanged', () => {
    expect(normalizeProgress(0.25)).toBe(0.25);
    expect(normalizeProgress(0.999)).toBe(0.999);
    expect(normalizeProgress(1)).toBe(1);
  });

  it('divides 0–100 percents into 0–1 fractions', () => {
    expect(normalizeProgress(50)).toBe(0.5);
    expect(normalizeProgress(100)).toBe(1);
    expect(normalizeProgress(38)).toBe(0.38);
  });

  it('clamps results above 1 down to 1 (defensive against drifted sources)', () => {
    expect(normalizeProgress(150)).toBe(1);
    expect(normalizeProgress(99999)).toBe(1);
  });
});
