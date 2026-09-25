// The lens — a Sarkar-Brown fisheye in SCREEN space.
//
// It magnifies locally instead of adding a zoom level, so the reader keeps
// their altitude while reading a dense cluster. Two numbers carry the owner's
// verdicts. The circle is 50 px (was 250) - "reduce size of the lens circle to
// 20% of its current size". The magnification is 2.6 - "soften the zoom of
// cursor lens, it manipulates with elements too much making them hard to
// click. Loosen the zooming/manipulation effect to 50%". That halves the
// factor from 5.2, so centre magnification falls from 6.2x to 3.6x and the
// displacement a star suffers at the rim halves with it.
//
// The falloff is CLAMPED AT 1: inside a circle this small nothing may ever be
// drawn smaller than it is outside, or the rim would hide more than the centre
// reveals.
//
// A star is always PICKABLE WHERE IT IS DRAWN: every pick target is pushed at
// the lensed coordinates (`paint.ts` calls `applyLens` before
// `picks.push`), so softening the lens changes where a star sits and where it
// is clicked by exactly the same amount.

/** Radius of the lens circle, in CSS pixels. 20% of the prototype's 250. */
export const LENS_R = 50;
/** Sarkar-Brown magnification factor. Centre magnification is `LENS_M + 1`. */
export const LENS_M = 2.6;

export interface LensState {
  on: boolean;
  /** Pointer position in stage pixels, or `null` when the pointer is away. */
  x: number | null;
  y: number | null;
}

/**
 * A point is NAMED at 15 px once the lens actually enlarges it this much.
 *
 * Retuned WITH `LENS_M`, not left alone. These are magnifications, and
 * halving the factor lowers the magnification at every radius - the old 1.9
 * and 2.6 were reached at 15.5% and 10.5% of the circle under 5.2, and under
 * 2.6 they are never reached at all, which would have silently stopped the
 * lens naming anything. The two numbers below are the magnifications the NEW
 * falloff produces at exactly those two radii, so the lens still names the
 * same few stars it always did.
 */
export const LENS_NAME_AT_DEPTH = 1.83;
export const LENS_NAME_AT_SKY = 2.22;

export type LensResult = [x: number, y: number, magnification: number];

/**
 * Displace a screen point through the lens. Returns the point unchanged, at
 * magnification 1, whenever the lens is off or the point is outside it.
 */
export function applyLens(lens: LensState, x: number, y: number): LensResult {
  if (!lens.on || lens.x === null || lens.y === null) return [x, y, 1];
  const dx = x - lens.x;
  const dy = y - lens.y;
  const d = Math.hypot(dx, dy);
  if (d > LENS_R || d < 0.0001) return [x, y, 1];
  const t = d / LENS_R;
  const f = ((LENS_M + 1) * t) / (LENS_M * t + 1);
  const s = f / t;
  return [lens.x + dx * s, lens.y + dy * s, Math.max(1, (LENS_M + 1) / Math.pow(LENS_M * t + 1, 2))];
}

/** Is the lens sitting close enough to a caption that the caption should stand down? */
export function lensShadows(lens: LensState, x: number, y: number, slack = 90): boolean {
  if (!lens.on || lens.x === null || lens.y === null) return false;
  return Math.hypot(lens.x - x, lens.y - y) < LENS_R + slack;
}
