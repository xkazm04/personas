// Spatial keyboard navigation for the canvas. Pure geometry, no React — the
// shell owns the cursor state, this owns the "which island is "right" of here?"
// decision, which is the only part with real logic worth testing.
//
// The map is spatial, so arrow keys navigate it spatially rather than walking a
// DOM order that would bear no relation to what the user sees.
import type { Island } from './types';

/** How far a candidate may drift sideways, as a multiple of its along-axis
 *  distance, before it stops counting as "in that direction". 2 is generous —
 *  a roughly-diagonal neighbour still answers to both of its axes, which is
 *  what people expect on a loose map. */
const CONE_RATIO = 2;

/** Lateral drift is weighted this much more heavily than along-axis distance,
 *  so "right" prefers the island actually beside you over a nearer one well
 *  off the axis. */
const PERP_WEIGHT = 2;

/**
 * The island a directional keypress should move to.
 *
 * Candidates must sit within a cone around the direction vector; the best is
 * the one minimising `along + PERP_WEIGHT * perp`. When the cone is empty the
 * plain nearest island is returned instead, so a sparse or single-column map
 * can never trap the cursor with no way out.
 *
 * @param dx/dy unit direction (1,0 = right, 0,-1 = up — screen axes, y down)
 * @returns the island to move to, or null when there is nowhere to go
 */
export function pickInDirection(
  islands: readonly Island[],
  from: Island,
  dx: number,
  dy: number,
): Island | null {
  let best: Island | null = null;
  let bestScore = Infinity;
  let fallback: Island | null = null;
  let fallbackD = Infinity;

  for (const i of islands) {
    if (i.slug === from.slug) continue;
    const ax = i.x - from.x;
    const ay = i.y - from.y;
    const along = ax * dx + ay * dy;
    const perp = Math.abs(ax * dy - ay * dx);
    const d = Math.hypot(ax, ay);
    if (d < fallbackD) { fallback = i; fallbackD = d; }
    if (along <= 0 || perp > along * CONE_RATIO) continue;
    const score = along + perp * PERP_WEIGHT;
    if (score < bestScore) { best = i; bestScore = score; }
  }
  return best ?? fallback;
}

/** The island nearest a world point — where the cursor enters the map. */
export function nearestTo(
  islands: readonly Island[],
  x: number,
  y: number,
): Island | null {
  let best: Island | null = null;
  let bestD = Infinity;
  for (const i of islands) {
    const d = Math.hypot(i.x - x, i.y - y);
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}
