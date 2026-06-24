/** Pure layout math for the fullscreen Fleet terminal grid overlay. */

/**
 * Max sessions for which the grid renders EVERY tile as a live (subscribed)
 * terminal instead of a cheap polled preview. At or below this count the user
 * almost certainly wants to watch them all at once, and the cost — one bounded
 * ring + one IPC stream + one WebGL context per tile — is trivial on a modern
 * machine. Above it, only the focused tile stays live and the rest fall back to
 * previews, keeping a 16-CLI grid light. Safe to tune: exceeding the WebView's
 * WebGL-context budget degrades gracefully to the DOM renderer, never crashes.
 */
export const MAX_LIVE_TILES = 6;

/** Whether a grid of `n` live sessions should render every tile live. */
export function allTilesLive(n: number): boolean {
  return n <= MAX_LIVE_TILES;
}

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
