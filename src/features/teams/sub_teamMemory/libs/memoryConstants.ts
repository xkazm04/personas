/** Importance range is 1-10 (integer). Backend defaults null to 3. */
export const IMPORTANCE_MIN = 1;
export const IMPORTANCE_MAX = 10;
export const IMPORTANCE_DEFAULT = 3;

/** Number of visual dots used to represent importance. */
export const IMPORTANCE_DOTS = 5;

/**
 * Importance value a dot rung stands for, anchored at both ends of the declared
 * range: rungs are `[1, 3, 6, 8, 10]`.
 *
 * The previous ladder was `(dotIndex + 1) * 2` — `{2,4,6,8,10}` — which never
 * produced `IMPORTANCE_MIN`. The two controls over this one field then
 * disagreed about its range: the edit-form slider reaches 1, the dot row could
 * not, and because `importanceToDots(1)` and `importanceToDots(2)` both
 * returned the same dot, clicking the *already filled* dot on a memory at
 * importance 1 silently rewrote it to 2 with no visible change.
 */
function rung(index: number): number {
  return IMPORTANCE_MIN + Math.round((index * (IMPORTANCE_MAX - IMPORTANCE_MIN)) / (IMPORTANCE_DOTS - 1));
}

/** The importance value behind each of the `IMPORTANCE_DOTS` rungs, low to high. */
export const IMPORTANCE_DOT_VALUES: readonly number[] = Array.from({ length: IMPORTANCE_DOTS }, (_, i) => rung(i));

/** Convert raw importance (1-10) to filled dot count (1-5) by nearest rung. */
export function importanceToDots(importance: number): number {
  let best = 0;
  for (let i = 1; i < IMPORTANCE_DOTS; i++) {
    if (Math.abs(rung(i) - importance) < Math.abs(rung(best) - importance)) best = i;
  }
  return best + 1;
}

/**
 * Convert a dot index (0-based) back to an importance value (1-10). Every
 * result is an exact rung, so `importanceToDots` maps it back to the same dot —
 * re-clicking a filled dot settles instead of drifting.
 */
export function dotsToImportance(dotIndex: number): number {
  return rung(Math.min(IMPORTANCE_DOTS - 1, Math.max(0, Math.round(dotIndex))));
}
