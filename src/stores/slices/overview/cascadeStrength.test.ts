import { describe, it, expect } from 'vitest';
import {
  coFailureStrength,
  COFAIL_RATE_THRESHOLD,
  COFAIL_MIN_SAMPLE,
} from './personaHealthSlice';

// A helper to build a daily series quickly.
const day = (date: string, success_rate: number) => ({ date, success_rate });

describe('coFailureStrength', () => {
  it('is 1.0 when both personas fail on exactly the same days', () => {
    const a = [day('d1', 0.2), day('d2', 0.3), day('d3', 0.9)];
    const b = [day('d1', 0.1), day('d2', 0.4), day('d3', 1.0)];
    // Shared fail days: d1 (both), d2 (both); d3 neither. eitherFail=2, coFail=2.
    expect(coFailureStrength(a, b)).toBe(1);
  });

  it('is 0 when failures never coincide (disjoint failure days)', () => {
    const a = [day('d1', 0.2), day('d2', 1.0), day('d3', 1.0)];
    const b = [day('d1', 1.0), day('d2', 0.2), day('d3', 0.2)];
    // eitherFail = d1,d2,d3 = 3; coFail = 0 ⇒ 0.
    expect(coFailureStrength(a, b)).toBe(0);
  });

  it('is a partial Jaccard when failures partly overlap', () => {
    const a = [day('d1', 0.2), day('d2', 0.2), day('d3', 1.0)];
    const b = [day('d1', 0.2), day('d2', 1.0), day('d3', 0.2)];
    // d1 both fail, d2 only a, d3 only b ⇒ eitherFail=3, coFail=1 ⇒ 1/3.
    expect(coFailureStrength(a, b)).toBeCloseTo(1 / 3, 10);
  });

  it('ignores non-shared days (only intersecting dates count)', () => {
    const a = [day('d1', 0.2), day('d2', 0.2)];
    const b = [day('d3', 0.2), day('d4', 0.2)];
    // No shared dates ⇒ eitherFail=0 < MIN_SAMPLE ⇒ 0.
    expect(coFailureStrength(a, b)).toBe(0);
  });

  it('returns 0 below the minimum-sample floor (one coincident bad day is not a correlation)', () => {
    const a = [day('d1', 0.2), day('d2', 1.0), day('d3', 1.0)];
    const b = [day('d1', 0.2), day('d2', 1.0), day('d3', 1.0)];
    // eitherFail = 1 (< COFAIL_MIN_SAMPLE = 2) ⇒ 0, despite a perfect overlap.
    expect(COFAIL_MIN_SAMPLE).toBe(2);
    expect(coFailureStrength(a, b)).toBe(0);
  });

  it('treats the threshold as failed-at-or-below (degraded counts as failure)', () => {
    const a = [day('d1', COFAIL_RATE_THRESHOLD), day('d2', COFAIL_RATE_THRESHOLD)];
    const b = [day('d1', COFAIL_RATE_THRESHOLD), day('d2', COFAIL_RATE_THRESHOLD)];
    // Both at exactly the threshold on 2 shared days ⇒ co-fail 2/2 = 1.
    expect(coFailureStrength(a, b)).toBe(1);
  });

  it('is symmetric', () => {
    const a = [day('d1', 0.2), day('d2', 0.9), day('d3', 0.2)];
    const b = [day('d1', 0.9), day('d2', 0.2), day('d3', 0.2)];
    expect(coFailureStrength(a, b)).toBe(coFailureStrength(b, a));
  });

  it('handles empty input without throwing', () => {
    expect(coFailureStrength([], [])).toBe(0);
  });
});
