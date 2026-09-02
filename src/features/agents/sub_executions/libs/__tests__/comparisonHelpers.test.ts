/**
 * The comparison surface's cost formatter used to be a private
 * reimplementation: it hardcoded `$` (so these numbers stayed `$0.0042` in a
 * fr-FR session while the rest of the app read `0,0042 $`) and returned
 * `'<$0.001'` for an EXACT zero — asserting a small nonzero cost for a run
 * that really cost nothing. `formatCost` has known both since formatters.ts.
 */
import { describe, it, expect } from 'vitest';
import { fmtCost, pctChange } from '../comparisonHelpers';
import { formatCost } from '@/lib/utils/formatters';

describe('fmtCost delegates to the app formatter', () => {
  it('renders an exact zero as zero, never as a sub-threshold value', () => {
    expect(fmtCost(0)).not.toContain('<');
    expect(fmtCost(0)).toBe(formatCost(0, { precision: 4 }));
  });

  it('agrees with formatCost at both precisions', () => {
    expect(fmtCost(0.0042)).toBe(formatCost(0.0042, { precision: 4 }));
    expect(fmtCost(1.5, { precision: 'auto' })).toBe(formatCost(1.5, { precision: 'auto' }));
  });

  it('still marks a genuinely sub-threshold cost as below the threshold', () => {
    expect(fmtCost(0.0000001)).toContain('<');
  });
});

describe('pctChange', () => {
  it('reads a 0 -> N growth as +100% — which is why callers must not pass `?? 0`', () => {
    expect(pctChange(0, 500)).toBe(100);
    expect(pctChange(0, 0)).toBe(0);
  });
});
