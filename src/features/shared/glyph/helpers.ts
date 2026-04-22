/** Center-out vertical stacking offset used by the side totems.
 *
 *   i = 0 → 0   (anchor at centre)
 *   i = 1 → -1  (first above)
 *   i = 2 → +1  (first below)
 *   i = 3 → -2  (second above)
 *   i = 4 → +2  (second below)
 *
 * Multiply the result by your per-row spacing to get a pixel offset. */
export function stackOffset(i: number): number {
  if (i === 0) return 0;
  const step = Math.ceil(i / 2);
  return i % 2 === 1 ? -step : step;
}
