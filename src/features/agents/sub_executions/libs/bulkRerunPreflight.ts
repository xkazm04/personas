// bulkRerunPreflight — what a bulk rerun will cost, computed BEFORE dispatch.
//
// `useBulkRerun.deriveCohort` already sums the cohort's original spend, and it
// is careful about it: a `null` origCost contributes nothing, because an
// unrecorded cost is not a $0 run. But it runs over `items`, which only exist
// once `start()` has fanned out `execute_persona` — so the one number an
// operator needs in order to REFUSE a forty-run rebill was computed just after
// the rebill began.
//
// This is the same arithmetic, over the selected rows, before anything is
// dispatched. It keeps the null discipline: priced rows are summed, unpriced
// rows are COUNTED and never coerced to zero, and a cohort with no priced row
// at all reports no total rather than a confident $0.00.

/** The rows a preflight can read: the list item's recorded cost, or nothing. */
export interface PreflightRow {
  cost_usd: number | null;
}

export interface BulkRerunPreflight {
  /** How many runs will be dispatched. */
  count: number;
  /** Of those, how many carry a recorded original cost. */
  pricedCount: number;
  /** Of those, how many do not — never folded into the total as zero. */
  unpricedCount: number;
  /**
   * Recorded original spend across the priced rows, or `null` when NO row
   * carries a cost. `null` is "we cannot say", which is a different statement
   * from `0`, and the dialog must be able to make it.
   */
  pricedTotalUsd: number | null;
}

export function preflightCohort(rows: readonly PreflightRow[]): BulkRerunPreflight {
  let pricedCount = 0;
  let total = 0;
  for (const r of rows) {
    if (r.cost_usd !== null && Number.isFinite(r.cost_usd)) {
      pricedCount += 1;
      total += r.cost_usd;
    }
  }
  return {
    count: rows.length,
    pricedCount,
    unpricedCount: rows.length - pricedCount,
    pricedTotalUsd: pricedCount > 0 ? total : null,
  };
}

/**
 * USD for the confirm body. Four decimals, matching the audit and comparison
 * surfaces in this feature — a rerun cohort is routinely sub-cent per run and
 * two decimals would round a real charge to nothing.
 */
export function formatPreflightUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}
