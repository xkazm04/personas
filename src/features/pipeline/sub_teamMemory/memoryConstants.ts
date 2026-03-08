/** Importance range is 1-10 (integer). Backend defaults null to 3. */
export const IMPORTANCE_MIN = 1;
export const IMPORTANCE_MAX = 10;
export const IMPORTANCE_DEFAULT = 3;

/** Number of visual dots used to represent importance. */
export const IMPORTANCE_DOTS = 5;

/** Convert raw importance (1-10) to filled dot count (1-5). */
export function importanceToDots(importance: number): number {
  return Math.min(IMPORTANCE_DOTS, Math.max(1, Math.round(importance / (IMPORTANCE_MAX / IMPORTANCE_DOTS))));
}

/** Convert a dot index (0-based) back to importance value (1-10). */
export function dotsToImportance(dotIndex: number): number {
  return Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, (dotIndex + 1) * (IMPORTANCE_MAX / IMPORTANCE_DOTS)));
}
