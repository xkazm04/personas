/**
 * The comparison surface's cost formatter used to be a private
 * reimplementation: it hardcoded `$` (so these numbers stayed `$0.0042` in a
 * fr-FR session while the rest of the app read `0,0042 $`) and returned
 * `'<$0.001'` for an EXACT zero — asserting a small nonzero cost for a run
 * that really cost nothing. `formatCost` has known both since formatters.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fmtCost, pctChange } from '../comparisonHelpers';
import { formatCost } from '@/lib/utils/formatters';
import { useI18nStore } from '@/stores/i18nStore';

afterEach(() => useI18nStore.setState({ language: 'en' }));

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

  /**
   * The locale-dependent half of the comparison surface.
   *
   * When `diffLines`/`jsonDiff` moved out of this module into the pure
   * `comparisonDiffCore` (to keep the i18n layer out of the Web Worker chunk —
   * 23.3 MB of it), the thing that had to stay true is that the numbers shown
   * NEXT to the diff are still formatted for the active UI language. This
   * module keeps its `formatCost` dependency precisely so they are.
   */
  it('follows the active UI language, not en-US', () => {
    useI18nStore.setState({ language: 'en' });
    const en = fmtCost(1234.5678);
    useI18nStore.setState({ language: 'cs' });
    const cs = fmtCost(1234.5678);

    expect(en).toBe('$1,234.5678');
    expect(cs).not.toBe(en);
    // cs groups with a NARROW NO-BREAK SPACE, not U+0020 — normalise before
    // comparing, or the assertion fails on a difference nobody can see.
    expect(cs.replace(/\s/gu, ' ')).toContain('1 234,5678');
  });
});

describe('pctChange', () => {
  it('reads a 0 -> N growth as +100% — which is why callers must not pass `?? 0`', () => {
    expect(pctChange(0, 500)).toBe(100);
    expect(pctChange(0, 0)).toBe(0);
  });
});
