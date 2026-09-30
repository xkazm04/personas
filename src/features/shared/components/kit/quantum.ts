/**
 * The quantum a UnitStrip draws a quantity in: the smallest step on the 1-2-5 ladder (1, 2, 5,
 * 10, 20, 50, ... and 0.1, 0.2, 0.5 below one) that is at least `min` and keeps `total` at or
 * under `maxUnits` units, so a busy month and a quiet day both draw a countable strip. Nothing to
 * draw (zero, negative, not a number) returns the smallest step at or above `min`. The caller
 * states the chosen step in its legend ("1 square = 5 runs").
 *
 * Lifted from Observability's `libs/quantum.ts` and the Factory's `unitQuantum`, which agreed on
 * every call they made; the ladder is anchored on decades, so a `min` of 0.5 steps 0.5, 1, 2, 5.
 * @catalog quantumFor - the 1-2-5 unit quantum that keeps a UnitStrip at or under maxUnits units. Kit.
 */
export function quantumFor(total: number, maxUnits = 60, min = 1): number {
  const floor = min > 0 && Number.isFinite(min) ? min : 1;
  const units = maxUnits > 0 && Number.isFinite(maxUnits) ? maxUnits : 1;
  const need = Number.isFinite(total) && total > 0 ? Math.max(floor, total / units) : floor;
  let mag = 10 ** Math.floor(Math.log10(need));
  // log10 of an exact power of ten can land one ulp under the integer; step down a decade and
  // let the ladder climb, which is exact either way.
  if (mag > need) mag /= 10;
  for (;;) {
    for (const step of [1, 2, 5]) {
      const q = clean(step * mag);
      if (q >= need * (1 - 1e-12)) return q;
    }
    mag *= 10;
  }
}

/** 3 * 0.1 is 0.30000000000000004; the ladder's steps are short decimals, so round them. */
function clean(q: number): number {
  return Number(q.toPrecision(12));
}
