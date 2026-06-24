/** Pure layout math for the fullscreen Fleet terminal grid overlay. */

/**
 * Column count for `n` sessions, capped at 4 → square grids 1×1 … 4×4.
 * 1→1, 2-4→2, 5-9→3, 10-16→4 (and 4 thereafter, the grid scrolls).
 */
export function gridDim(n: number): number {
  if (n <= 1) return 1;
  return Math.min(4, Math.ceil(Math.sqrt(n)));
}

/**
 * Density-scaled terminal font (px). Smaller as the grid densifies so more
 * columns/rows fit per tile, with a 12px floor for legibility (VS Code's
 * terminal default is 14px for reference). The page chrome is unaffected.
 */
export function densityFont(dim: number): number {
  switch (dim) {
    case 1:
      return 15;
    case 2:
      return 14;
    case 3:
      return 13;
    default:
      return 12;
  }
}
