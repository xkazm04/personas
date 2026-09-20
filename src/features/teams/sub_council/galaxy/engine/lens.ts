// The lens — a Sarkar-Brown fisheye in SCREEN space.
//
// It magnifies locally instead of adding a zoom level, so the reader keeps
// their altitude while reading a dense cluster. Two numbers carry the owner's
// verdict ("reduce size of the lens circle to 20% of its current size"):
// the circle is 50 px (was 250), and the magnification was retuned 2.6 -> 5.2
// to keep the few stars it holds legible at that size.
//
// The falloff is CLAMPED AT 1: inside a circle this small nothing may ever be
// drawn smaller than it is outside, or the rim would hide more than the centre
// reveals.

/** Radius of the lens circle, in CSS pixels. 20% of the prototype's 250. */
export const LENS_R = 50;
/** Sarkar-Brown magnification factor. Centre magnification is `LENS_M + 1`. */
export const LENS_M = 5.2;

export interface LensState {
  on: boolean;
  /** Pointer position in stage pixels, or `null` when the pointer is away. */
  x: number | null;
  y: number | null;
}

/** A point is NAMED at 15 px once the lens actually enlarges it this much. */
export const LENS_NAME_AT_DEPTH = 1.9;
export const LENS_NAME_AT_SKY = 2.6;

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
