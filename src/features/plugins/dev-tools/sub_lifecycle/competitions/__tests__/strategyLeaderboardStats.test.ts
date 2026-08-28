import { describe, it, expect } from 'vitest';
import {
  wilsonInterval,
  isTopOrderingSeparated,
  MIN_RANKABLE_SAMPLE,
} from '../StrategyLeaderboard';

describe('wilsonInterval', () => {
  it('returns the whole range when there are no trials at all', () => {
    // No evidence must not read as a narrow claim.
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('does NOT collapse to a point at a perfect record over one race', () => {
    // This is the whole reason the panel uses Wilson and not the normal
    // approximation: 1/1 under the normal interval has zero width, i.e. it
    // asserts certainty from a single race.
    const ci = wilsonInterval(1, 1);
    expect(ci.high).toBe(1);
    expect(ci.low).toBeLessThan(0.9);
    expect(ci.high - ci.low).toBeGreaterThan(0.1);
  });

  it('narrows as the sample grows at the same win rate', () => {
    const small = wilsonInterval(4, 5);
    const large = wilsonInterval(80, 100);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('brackets the observed rate', () => {
    const ci = wilsonInterval(7, 10);
    expect(ci.low).toBeLessThanOrEqual(0.7);
    expect(ci.high).toBeGreaterThanOrEqual(0.7);
  });

  it('stays inside [0, 1] at the extremes', () => {
    for (const ci of [wilsonInterval(0, 3), wilsonInterval(3, 3), wilsonInterval(0, 1)]) {
      expect(ci.low).toBeGreaterThanOrEqual(0);
      expect(ci.high).toBeLessThanOrEqual(1);
      expect(ci.low).toBeLessThanOrEqual(ci.high);
    }
  });
});

describe('isTopOrderingSeparated', () => {
  it('treats an empty or single-row board as separated (no comparison is made)', () => {
    expect(isTopOrderingSeparated([])).toBe(true);
    expect(isTopOrderingSeparated([{ wins: 1, total: 1 }])).toBe(true);
  });

  it('refuses to call a 1-0 vs 0-1 board a result', () => {
    // The exact shape a fresh competition project produces, and the one the
    // panel used to render as a ranked conclusion.
    expect(isTopOrderingSeparated([{ wins: 1, total: 1 }, { wins: 0, total: 1 }])).toBe(false);
  });

  it('refuses when the two intervals overlap at a moderate sample', () => {
    expect(isTopOrderingSeparated([{ wins: 6, total: 10 }, { wins: 4, total: 10 }])).toBe(false);
  });

  it('accepts a genuinely separated pair at a large sample', () => {
    expect(isTopOrderingSeparated([{ wins: 95, total: 100 }, { wins: 10, total: 100 }])).toBe(true);
  });

  it('only reads the top pair — a weak third row does not change the verdict', () => {
    const top = { wins: 95, total: 100 };
    const second = { wins: 10, total: 100 };
    expect(isTopOrderingSeparated([top, second, { wins: 1, total: 1 }])).toBe(true);
  });
});

describe('MIN_RANKABLE_SAMPLE', () => {
  it('is above the one-to-three races a real competition project starts with', () => {
    expect(MIN_RANKABLE_SAMPLE).toBeGreaterThan(3);
  });
});
