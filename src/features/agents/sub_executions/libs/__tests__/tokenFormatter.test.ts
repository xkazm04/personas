/**
 * One token-count formatter for the execution surfaces. The ledger used a
 * private `formatTokens` (useExecutionList.ts) that disagreed with the
 * comparison's `fmtTokens` on zero ('-' vs '0'). The absent case is now an
 * explicit option of the single formatter.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { fmtTokens } from '../comparisonHelpers';

const LIBS = resolve(__dirname, '..');

describe('token formatter', () => {
  it('has exactly one exported token formatter in the executions libs', () => {
    const files = ['useExecutionList.ts', 'comparisonHelpers.ts'];
    const found = files.flatMap((f) =>
      [...readFileSync(resolve(LIBS, f), 'utf8').matchAll(/export (?:function|const) (formatTokens|fmtTokens)\b/g)].map(
        (m) => `${f}:${m[1]}`,
      ),
    );
    expect(found).toEqual(['comparisonHelpers.ts:fmtTokens']);
  });

  it('formats a measured zero as 0 unless the caller names an absent label', () => {
    const inputs = [0, 999, 1500, 2_000_000];
    expect(inputs.map((n) => fmtTokens(n))).toEqual(['0', '999', '1.5k', '2000.0k']);
    expect(inputs.map((n) => fmtTokens(n, { zeroAs: '-' }))).toEqual(['-', '999', '1.5k', '2000.0k']);
    expect(fmtTokens(2_000_000, { withMillions: true })).toBe('2.0M');
  });
});
