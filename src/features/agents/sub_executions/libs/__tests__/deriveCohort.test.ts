/**
 * The cohort's two cost totals must cover the same runs, and disclose the runs
 * they skipped for want of a price. Before: `totalCostOriginal` summed every
 * priced original (dispatched or not) while `totalCostNew` summed only landed
 * re-runs, and the report set them side by side as if comparable.
 */
import { describe, it, expect } from 'vitest';
import { deriveCohort, type BulkRunItem } from '../useBulkRerun';

function item(over: Partial<BulkRunItem>): BulkRunItem {
  return {
    originalId: 'o', origStatus: 'failed', origCost: null, origDurationMs: null,
    origInputTokens: 0, origOutputTokens: 0, status: 'pending', newExecutionId: null,
    newStatus: null, newCost: null, newDurationMs: null, newInputTokens: null,
    newOutputTokens: null, error: null, ...over,
  };
}

describe('deriveCohort cost totals', () => {
  it('sums both totals over the landed runs only and counts the unpriced', () => {
    const items = [
      // unpriced original, landed priced re-run
      item({ originalId: 'a', origCost: null, status: 'success', newStatus: 'completed', newCost: 1 }),
      // priced original, landed priced re-run
      item({ originalId: 'b', origCost: 2, status: 'success', newStatus: 'completed', newCost: 1.5 }),
      // priced original, cancelled before dispatch
      item({ originalId: 'c', origCost: 4 }),
    ];
    const c = deriveCohort(items);
    expect(c.landedCount).toBe(2);
    expect(c.totalCostOriginal).toBe(2); // run c never landed: not counted
    expect(c.totalCostNew).toBe(2.5);
    expect(c.unpricedOriginalCount).toBe(1); // run a
    expect(c.unpricedNewCount).toBe(0);
  });

  it('counts a landed re-run without a recorded cost as unpriced', () => {
    const c = deriveCohort([
      item({ origCost: 3, status: 'success', newStatus: 'completed', newCost: null }),
    ]);
    expect(c.unpricedNewCount).toBe(1);
    expect(c.totalCostNew).toBe(0);
  });
});
