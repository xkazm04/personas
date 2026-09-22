// The books have to balance. A ledger that prints a total nobody can check is
// a ledger nobody should believe.
import { describe, expect, it } from 'vitest';

import type { KpiTally } from '../estate/kpiEstate';
import { EMPTY_TALLY } from '../estate/kpiEstate';
import { balances, debtsOf, largestClaim, sumDebts, type BookRow } from '../variants/ledger/kpiBooks';

function tally(over: Partial<KpiTally>): KpiTally {
  return { ...EMPTY_TALLY, ...over };
}

function row(id: string, t: KpiTally): BookRow {
  return {
    id, kind: 'project', rank: 1, label: id, context: null, projectId: id, groupId: null,
    tally: t, debts: debtsOf(t), lastReadAt: null,
  };
}

describe('debtsOf', () => {
  it('names the three debts separately, because they are different work', () => {
    const d = debtsOf(tally({ total: 10, measured: 6, unmeasured: 4, unpaced: 2, stale: 0, met: 4, verdicts: 4 }));
    expect(d).toEqual({ reading: 4, verdict: 2, refresh: 0, total: 6 });
  });

  it('never double-counts a stale KPI that is also ungradable', () => {
    // 3 measured, all 3 unpaced, and all 3 stale: the place owes 3, not 6.
    const d = debtsOf(tally({ total: 3, measured: 3, unmeasured: 0, unpaced: 3, stale: 3 }));
    expect(d.verdict).toBe(3);
    expect(d.refresh).toBe(0);
    expect(d.total).toBe(3);
  });

  it('counts a refresh only for the stale KPIs that DO carry a verdict', () => {
    const d = debtsOf(tally({ total: 5, measured: 5, unpaced: 1, stale: 4, met: 4, verdicts: 4 }));
    expect(d.verdict).toBe(1);
    expect(d.refresh).toBe(3);
  });

  it('a place that owes nothing says so with a zero, not a blank', () => {
    expect(debtsOf(tally({ total: 2, measured: 2, met: 2, verdicts: 2 })).total).toBe(0);
  });
});

describe('balances — declared = observed + reading owed', () => {
  it('holds for a real tally and fails loudly for an impossible one', () => {
    expect(balances(tally({ total: 10, measured: 6, unmeasured: 4 }))).toBe(true);
    expect(balances(tally({ total: 10, measured: 6, unmeasured: 3 }))).toBe(false);
  });
});

describe('page arithmetic', () => {
  it('finds the largest claim for the shared size scale, and never divides by zero', () => {
    expect(largestClaim([row('a', tally({ total: 9 })), row('b', tally({ total: 721 }))])).toBe(721);
    expect(largestClaim([])).toBe(1);
  });

  it('adds the columns up so the footer can be checked against the header', () => {
    const rows = [
      row('a', tally({ total: 10, measured: 6, unmeasured: 4, unpaced: 1, stale: 2, met: 5, verdicts: 5 })),
      row('b', tally({ total: 4, measured: 0, unmeasured: 4 })),
    ];
    const total = sumDebts(rows);
    expect(total.reading).toBe(8);
    expect(total.verdict).toBe(1);
    expect(total.refresh).toBe(1);
    expect(total.total).toBe(10);
  });
});
