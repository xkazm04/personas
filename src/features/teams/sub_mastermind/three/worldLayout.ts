// Portfolio layout + camera fitting, shared by every 3D variant.
//
// Round 2 made this its own module for one reason: with two projects a row was
// enough and the L0 camera could be a constant. With ten it is neither — the
// world has to lay itself out in a block and the camera has to be DERIVED from
// the block's real bounds, or the portfolio either overflows the frame or
// floats in the middle of an empty one. Both worlds now compute their L0 pose
// from `fitPortfolio`, so adding an eleventh project changes the camera by
// itself.
//
// Pure maths — no React, no three (Vec3 is a plain tuple). Unit-testable.
import type { Vec3 } from './sceneBits';

/** Layout aspect the grid is shaped for. DELIBERATELY A CONSTANT, not the live
 *  viewport: world geometry that reflows when you resize the window makes
 *  every remembered position a lie. The camera absorbs the viewport instead. */
const LAYOUT_ASPECT = 1.55;

export interface Bounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  cx: number; cz: number;
  width: number; depth: number;
  /** Radius of the sphere that encloses the footprint. */
  radius: number;
}

/**
 * Places `n` projects on a centred grid: near-square, wider than deep, last
 * row centred on the ones above it. Index order is preserved, so a project's
 * slot is a property of its position in the world list and nothing else.
 */
export function gridSlots(n: number, spacing: number): Vec3[] {
  if (n <= 0) return [];
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * LAYOUT_ASPECT))));
  const rows = Math.ceil(n / cols);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = i - row * cols;
    const x = (col - (inRow - 1) / 2) * spacing;
    const z = (row - (rows - 1) / 2) * spacing;
    out.push([x, 0, z]);
  }
  return out;
}

/** Slug → world position, using `gridSlots` in world order. */
export function gridPositions(slugs: string[], spacing: number): Record<string, Vec3> {
  const slots = gridSlots(slugs.length, spacing);
  const out: Record<string, Vec3> = {};
  slugs.forEach((s, i) => { out[s] = slots[i] ?? [0, 0, 0]; });
  return out;
}

/** Footprint of a set of positions, padded by half a project's own width. */
export function worldBounds(positions: Vec3[], pad: number): Bounds {
  if (positions.length === 0) {
    return { minX: -pad, maxX: pad, minZ: -pad, maxZ: pad, cx: 0, cz: 0, width: pad * 2, depth: pad * 2, radius: pad * Math.SQRT2 };
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, , z] of positions) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, width, depth, radius: Math.hypot(width, depth) / 2 };
}

export interface FitOptions {
  /** Vertical field of view in degrees (the Canvas camera's `fov`). */
  fov: number;
  /** Viewport aspect (width / height). */
  aspect: number;
  /** Camera elevation above the floor plane, in degrees. */
  pitch: number;
  /** How high off the floor the content actually sits (stack height). */
  contentHeight?: number;
  /** Extra room around the footprint. 1 = tight, 1.15 = comfortable. */
  margin?: number;
}

/**
 * A camera pose that frames `bounds` whatever the viewport is.
 *
 * Fits the footprint RECTANGLE, not its bounding sphere. The first version
 * fitted the sphere because it is orientation-free and cannot under-shoot —
 * and it under-used the frame so badly that ten projects sat in a small block
 * in the middle of the canvas. A grid seen from a fixed pitch has a knowable
 * on-screen extent, so compute it: full width horizontally, and vertically the
 * depth foreshortened by the pitch plus the stack height standing up out of it.
 * The binding constraint is whichever axis needs the greater distance, which on
 * a narrow canvas is the horizontal one.
 */
export function fitPortfolio(bounds: Bounds, opts: FitOptions): { position: Vec3; target: Vec3; distance: number } {
  const { fov, aspect, pitch, contentHeight = 0, margin = 1.08 } = opts;
  const vFov = (fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, aspect));
  const rad = (pitch * Math.PI) / 180;

  const halfW = bounds.width / 2;
  const halfH = (bounds.depth * Math.sin(rad) + contentHeight * Math.cos(rad)) / 2;

  const distW = halfW / Math.tan(hFov / 2);
  const distH = halfH / Math.tan(vFov / 2);
  // The far edge of the footprint is further away than its centre, so add half
  // the depth measured along the view direction — without it the back row
  // clips out of frame on a shallow pitch.
  const distance = Math.max(distW, distH) * margin + (bounds.depth * Math.cos(rad)) / 2;

  const ty = contentHeight * 0.35;
  return {
    position: [bounds.cx, ty + distance * Math.sin(rad), bounds.cz + distance * Math.cos(rad)],
    target: [bounds.cx, ty, bounds.cz],
    distance,
  };
}

/**
 * True when the portfolio is crowded enough that per-project chrome has to get
 * quieter — smaller labels, no per-dimension text. The threshold is a count,
 * not a distance: what makes ten projects unreadable is ten labels competing,
 * and that is true at every zoom.
 */
export const isDensePortfolio = (n: number): boolean => n > 4;
