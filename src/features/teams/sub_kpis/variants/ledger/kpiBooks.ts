// THE BOOKS - the portfolio stated as double entry.
//
// `declared = observed + reading owed`. The 900 KPIs nobody has read stop
// being a grey blank and become a LIABILITY that every row has to balance, so
// a state colour can never appear without the denominator it was drawn over.
// Three debts, and they are different work:
//
//   reading owed - never measured. Somebody has to take a first reading, or
//                  admit the KPI was never real and prune it.
//   verdict owed - measured, and ungradable. The number exists; the target,
//                  baseline or date that would let it be judged does not.
//   refresh owed - measured, judged, and older than the cadence it promised.
//
// Pure: no React. The wording lives in i18n, the arithmetic lives here.
import type { KpiTally } from '../../estate/kpiEstate';

export interface Debts {
  /** Never measured. */
  reading: number;
  /** Measured, no verdict possible. */
  verdict: number;
  /** Measured and judged, but the reading has gone stale. */
  refresh: number;
  /** reading + verdict + refresh - what this place owes in total. */
  total: number;
}

export function debtsOf(tally: KpiTally): Debts {
  const reading = tally.unmeasured;
  const verdict = tally.unpaced;
  // A stale KPI that is ALSO ungradable is already counted as a verdict debt;
  // counting it twice would make the books say the place owes more than it
  // declared, which is the one thing a ledger may never do.
  const refresh = Math.max(0, tally.stale - Math.min(tally.stale, tally.unpaced));
  return { reading, verdict, refresh, total: reading + verdict + refresh };
}

/** Does the entry balance? `declared === observed + reading owed` is an
 *  identity, not a measurement - if it ever fails, a count is wrong and the
 *  surface must say so rather than print a total nobody can check. */
export function balances(tally: KpiTally): boolean {
  return tally.total === tally.measured + tally.unmeasured;
}

export type BookRowKind = 'project' | 'group' | 'kpi';

export interface BookRow {
  id: string;
  kind: BookRowKind;
  rank: number;
  label: string;
  /** The owner one level up, when the page spans more than one. */
  context: string | null;
  projectId: string;
  groupId: string | null;
  tally: KpiTally;
  debts: Debts;
  lastReadAt: number | null;
}

/** The largest claim on a page, for the shared size scale. Never 0, so a page
 *  of empty places still divides. */
export function largestClaim(rows: BookRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.tally.total), 1);
}

/** Totals for the page's footer: the columns have to add up to the header. */
export function sumDebts(rows: BookRow[]): Debts {
  return rows.reduce<Debts>(
    (acc, r) => ({
      reading: acc.reading + r.debts.reading,
      verdict: acc.verdict + r.debts.verdict,
      refresh: acc.refresh + r.debts.refresh,
      total: acc.total + r.debts.total,
    }),
    { reading: 0, verdict: 0, refresh: 0, total: 0 },
  );
}
