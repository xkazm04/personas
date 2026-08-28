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

/** Petal silhouette geometry, as a fraction of the sigil's square size.
 *
 * ONE definition on purpose. `InteractiveSigil` builds the petal `<path>` from
 * these ratios; `SigilPetal` draws the linear-gradient stops and the tip dot
 * against that same path in `userSpaceOnUse` coordinates, so it has to derive
 * its radii from the identical numbers. A second copy is a silent
 * mis-registration waiting for the first person who tunes the silhouette —
 * nothing type-checks or renders differently until the gradient no longer
 * lines up with the shape it is filling. */
export const PETAL_OUTER_RATIO = 0.44;
export const PETAL_INNER_RATIO = 0.14;
