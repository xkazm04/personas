import { describe, it, expect } from 'vitest';
import { nextRevealCount } from '../useProgressiveReveal';

const SCHED = { initialCount: 24, targetMs: 2000, minChunk: 6, intervalMs: 90 };

/** How many ticks the cadence takes to reveal `total` rows from `initialCount`. */
function ticksToFull(total: number, sched = SCHED): number {
  let current = Math.min(sched.initialCount, total);
  let ticks = 0;
  // Guard against an infinite loop if the math ever fails to advance.
  while (current < total && ticks < 10_000) {
    const next = nextRevealCount(current, total, sched);
    expect(next).toBeGreaterThan(current); // must always make progress
    current = next;
    ticks++;
  }
  return ticks;
}

describe('nextRevealCount', () => {
  it('returns total immediately when already complete', () => {
    expect(nextRevealCount(100, 100, SCHED)).toBe(100);
    expect(nextRevealCount(120, 100, SCHED)).toBe(100);
  });

  it('never exceeds total on the final chunk', () => {
    expect(nextRevealCount(98, 100, SCHED)).toBe(100);
  });

  it('advances by at least minChunk for small lists', () => {
    // 40 rows: remaining 16 over 22 ticks → ceil = 1, floored to minChunk (6).
    expect(nextRevealCount(24, 40, SCHED)).toBe(30);
  });

  it('lands within the target window (≈targetMs) regardless of list size', () => {
    const budget = Math.round(SCHED.targetMs / SCHED.intervalMs); // ~22 ticks
    for (const total of [100, 250, 500, 1000, 5000]) {
      const ticks = ticksToFull(total);
      // Big lists scale the chunk so wall-clock stays bounded near the target.
      expect(ticks).toBeLessThanOrEqual(budget + 1);
    }
  });

  it('reveals small lists quickly (well under the target)', () => {
    expect(ticksToFull(100)).toBeLessThanOrEqual(15);
  });

  it('handles a total smaller than the initial batch', () => {
    expect(ticksToFull(10)).toBe(0);
  });
});
