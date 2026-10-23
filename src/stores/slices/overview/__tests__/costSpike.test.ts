/**
 * `cost_spike` divided the newest chart bucket by the MEAN of every bucket
 * including it. The background evaluator fetched a ONE-DAY window, so that was
 * one sample over itself: the ratio collapsed to 1x and the metric operators
 * configure to catch runaway spend was the one metric the always-on loop could
 * never fire. The Observability tab, on a user-selected 30-day range, could
 * fire the same rule the background loop never would.
 *
 * The reading is now the newest bucket against the MEDIAN OF THE PRIOR ones.
 */
import { describe, it, expect } from 'vitest';
import { readCostSpike } from '../alertSlice';

const points = (...costs: number[]) => costs.map((cost) => ({ cost }));

/** The ratio `evaluateRule` computes for a cost_spike rule. */
const ratio = (reading: { today: number; baseline: number | null }) =>
  reading.baseline === null ? null : reading.today / reading.baseline;

describe('readCostSpike', () => {
  it('claims no reading at all from a single bucket', () => {
    const r = readCostSpike(points(50));

    expect(r.today).toBe(50);
    // Not 1x, and not 0x — both would be a claim about a spike we cannot see.
    expect(r.baseline).toBeNull();
  });

  it('claims no reading from an empty window', () => {
    expect(readCostSpike([])).toEqual({ today: 0, baseline: null });
  });

  it('fires for a last day well above the prior median', () => {
    // A quiet week, then a 3x day.
    const r = readCostSpike(points(10, 10, 12, 9, 11, 10, 10, 30));

    expect(r.today).toBe(30);
    expect(r.baseline).toBe(10);
    expect(ratio(r)!).toBeGreaterThan(2);
  });

  it('excludes today from its own baseline', () => {
    // With today folded into a mean, this 8x day reads as ~3.6x; against the
    // prior median it reads as the 8x it is.
    const r = readCostSpike(points(10, 10, 10, 80));

    expect(r.baseline).toBe(10);
    expect(ratio(r)).toBe(8);
  });

  it('does not let one earlier spike raise the bar — median, not mean', () => {
    // Mean of the priors is 32.5; the median is 10, so a 30-cost day is still
    // the 3x it looks like to an operator.
    const r = readCostSpike(points(10, 10, 110, 30));

    expect(r.baseline).toBe(10);
    expect(ratio(r)).toBe(3);
  });

  it('stays near 1x on a flat week, so a steady spend never fires', () => {
    const r = readCostSpike(points(10, 10, 10, 10, 10, 10, 10, 11));

    expect(ratio(r)!).toBeLessThan(1.2);
  });

  it('agrees on fire / no-fire between a short and a long window for the same last day', () => {
    const long = points(...Array.from({ length: 29 }, () => 10), 40);
    const short = points(10, 10, 10, 10, 10, 10, 10, 40);

    expect(ratio(readCostSpike(long))).toBe(4);
    expect(ratio(readCostSpike(short))).toBe(4);

    const quietLong = points(...Array.from({ length: 29 }, () => 10), 11);
    const quietShort = points(10, 10, 10, 10, 10, 10, 10, 11);
    expect(ratio(readCostSpike(quietLong))!).toBeLessThan(2);
    expect(ratio(readCostSpike(quietShort))!).toBeLessThan(2);
  });

  it('averages the middle pair on an even number of priors', () => {
    const r = readCostSpike(points(10, 20, 60));

    expect(r.baseline).toBe(15);
  });

  it('refuses a reading when the priors cost nothing — a ratio over zero is not a spike', () => {
    expect(readCostSpike(points(0, 0, 0, 25)).baseline).toBeNull();
  });

  it('reads a drop to zero as a real 0x rather than no reading', () => {
    const r = readCostSpike(points(10, 10, 10, 0));

    expect(r.baseline).toBe(10);
    expect(ratio(r)).toBe(0);
  });
});
