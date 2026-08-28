import { describe, it, expect } from 'vitest';
import {
  IMPORTANCE_MIN,
  IMPORTANCE_MAX,
  IMPORTANCE_DOTS,
  IMPORTANCE_DOT_VALUES,
  importanceToDots,
  dotsToImportance,
} from '../memoryConstants';

describe('importance dot ladder', () => {
  it('spans the whole declared range, min and max included', () => {
    expect(IMPORTANCE_DOT_VALUES).toHaveLength(IMPORTANCE_DOTS);
    expect(IMPORTANCE_DOT_VALUES[0]).toBe(IMPORTANCE_MIN);
    expect(IMPORTANCE_DOT_VALUES[IMPORTANCE_DOTS - 1]).toBe(IMPORTANCE_MAX);
  });

  it('rises monotonically', () => {
    for (let i = 1; i < IMPORTANCE_DOT_VALUES.length; i++) {
      expect(IMPORTANCE_DOT_VALUES[i]).toBeGreaterThan(IMPORTANCE_DOT_VALUES[i - 1]);
    }
  });

  it('makes IMPORTANCE_MIN reachable from the dot row', () => {
    expect(dotsToImportance(0)).toBe(IMPORTANCE_MIN);
  });

  it('clicking the already-filled dot is a no-op, never a silent rewrite', () => {
    // The regression this guards: a memory at importance 1 rendered one filled
    // dot, and clicking that same dot rewrote it to 2 with no visible change.
    for (let importance = IMPORTANCE_MIN; importance <= IMPORTANCE_MAX; importance++) {
      const dots = importanceToDots(importance);
      const settled = dotsToImportance(dots - 1);
      // Re-clicking the dot the value already sits on must be idempotent.
      expect(dotsToImportance(importanceToDots(settled) - 1)).toBe(settled);
    }
  });

  it('round-trips every ladder value exactly', () => {
    IMPORTANCE_DOT_VALUES.forEach((value, index) => {
      expect(importanceToDots(value)).toBe(index + 1);
      expect(dotsToImportance(index)).toBe(value);
    });
  });

  it('keeps dot counts inside 1..IMPORTANCE_DOTS for the whole range', () => {
    for (let importance = IMPORTANCE_MIN; importance <= IMPORTANCE_MAX; importance++) {
      const dots = importanceToDots(importance);
      expect(dots).toBeGreaterThanOrEqual(1);
      expect(dots).toBeLessThanOrEqual(IMPORTANCE_DOTS);
    }
  });

  it('clamps out-of-range dot indices instead of returning undefined', () => {
    expect(dotsToImportance(-3)).toBe(IMPORTANCE_MIN);
    expect(dotsToImportance(IMPORTANCE_DOTS + 4)).toBe(IMPORTANCE_MAX);
  });
});
