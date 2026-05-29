// Verdict computation for the eval rubric (docs/test/evaluation-rubric.md).
//
// This module collapses the five verdict caps that were previously scattered
// across evaluate.mjs into ONE ordered fold over a declarative cap list. The
// fold is order-independent (cap() is min-by-rank, and min is commutative), but
// kept ordered to mirror the rubric's narrative. Behavior is byte-for-byte
// preserved vs. the prior inline caps — guarded by tests/cli/verdict.test.mjs
// and the golden-diff over the three reference runs.

import { RUBRIC } from '../rubric.mjs';

/** Verdict ordering, worst → best. */
export const RANK = { BROKEN: 0, 'NOT-READY': 1, PROMISING: 2, PRODUCTION: 3 };

/** Cap a verdict at `max` (lower it if it currently outranks `max`). */
export function cap(v, max) {
  return RANK[v] > RANK[max] ? max : v;
}

/**
 * Band a team into a verdict from its score, the weakest persona output, and
 * the autonomy/health gates.
 *
 * NOTE: the duplicated NOT-READY floor (`>= 30` and the final `else` both
 * return 'NOT-READY') is INTENTIONAL and preserved verbatim — the rubric has no
 * band below NOT-READY other than the health-gated BROKEN. Do not "simplify".
 */
export function band(team, minPersona, autonomyOk, healthOk) {
  const b = RUBRIC.band;
  if (!healthOk) return 'BROKEN';
  if (team >= b.productionTeam && minPersona >= b.productionMinPersona && autonomyOk) return 'PRODUCTION';
  if (team >= b.promisingTeam) return 'PROMISING';
  if (team >= b.notReadyFloor) return 'NOT-READY';
  return 'NOT-READY';
}

/**
 * Fold a base verdict through an ordered list of caps. Each cap is
 * `{ when: boolean, to: verdict }`; a cap with `when` truthy lowers the verdict
 * to at most `to`.
 */
export function computeVerdict(base, caps) {
  let v = base;
  for (const c of caps) {
    if (c.when) v = cap(v, c.to);
  }
  return v;
}
