// The camera, its altitude ladder and its tween.
//
// Two properties are load-bearing and are ported unchanged from the reference
// (`index.html:501-506`, `:483-486`, `:1052-1057`):
//
//  1. the tween interpolates SCALE IN LOG SPACE, so a flight from the sky to
//     one technique reads as one continuous movement rather than a lurch;
//  2. `fitToSet` frames a SET of stars, which is what council focus needs —
//     the minimal view that holds every star a council lands on.
//
// Pure functions, no canvas, no DOM. Everything here is unit-testable.
import type { CameraState, DomainNode, CategoryNode } from './types';

/** The stage rectangle the camera projects into (the bench eats the bottom). */
export interface Viewport {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const MAX_SCALE = 90;

export function viewportCentre(v: Viewport): { cx: number; cy: number } {
  return { cx: (v.x0 + v.x1) / 2, cy: (v.y0 + v.y1) / 2 };
}

export function viewportSpan(v: Viewport): number {
  return Math.min(v.x1 - v.x0, v.y1 - v.y0);
}

/** The scale at which the whole field just fits. */
export function skyScale(v: Viewport, boundRadius: number): number {
  return viewportSpan(v) / Math.max(1, boundRadius * 2.14);
}

/** "The zoom a node deserves" — one per altitude. */
export function domainScale(v: Viewport, d: DomainNode): number {
  return (viewportSpan(v) * 0.42) / d.r;
}

export function categoryScale(v: Viewport, c: CategoryNode): number {
  return (viewportSpan(v) * 0.44) / c.r;
}

export function subjectScale(v: Viewport): number {
  return viewportSpan(v) / 40;
}

/**
 * The minimal enclosing view of a set of points, and the altitude that holds
 * them all. Council focus flies here: one category if the set shares one, one
 * cluster if it shares one, the whole field if it spans several.
 */
export function fitToSet(v: Viewport, points: Array<{ x: number; y: number }>): CameraState | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const k = Math.max(
    0.1,
    Math.min(
      3.4,
      Math.min((v.x1 - v.x0) / Math.max(x1 - x0 + 520, 520), (v.y1 - v.y0) / Math.max(y1 - y0 + 420, 420)),
    ),
  );
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k };
}

/**
 * The APP'S easing curve, not a curve of the canvas's own.
 *
 * `animationPresets.ts:27` declares `[0.22, 1, 0.36, 1]` and every framer
 * transition and every `duration-*` class in the app runs on it. The camera
 * used an `easeInOutCubic` it had invented, so a descent and the rail flip it
 * is supposed to arrive with moved on two different curves - the DOM easing
 * out of the gate while the canvas was still easing in. One curve, evaluated
 * here, is what makes them read as one movement.
 */
export const EASE_CURVE: readonly [number, number, number, number] = [0.22, 1, 0.36, 1];

const [X1, Y1, X2, Y2] = EASE_CURVE;
const CX = 3 * X1;
const BX = 3 * (X2 - X1) - CX;
const AX = 1 - CX - BX;
const CY = 3 * Y1;
const BY = 3 * (Y2 - Y1) - CY;
const AY = 1 - CY - BY;

const sampleX = (t: number): number => ((AX * t + BX) * t + CX) * t;
const sampleY = (t: number): number => ((AY * t + BY) * t + CY) * t;
const slopeX = (t: number): number => (3 * AX * t + 2 * BX) * t + CX;

/**
 * `cubic-bezier(0.22, 1, 0.36, 1)` at progress `p`.
 *
 * Newton on the x polynomial, then y. Eight iterations is more than this
 * curve ever needs and is still nothing beside the frame it is drawing. The
 * clamp at both ends is load-bearing: the flight's last frame snaps to the
 * target and `climb()` promises the camera returns EXACTLY where it was.
 */
export function easeStandard(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = slopeX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  return sampleY(t);
}

/**
 * One step of a flight. Scale moves in log space; position moves linearly.
 * Exported so the tween is testable without a frame loop.
 */
export function tweenCamera(from: CameraState, to: CameraState, p: number): CameraState {
  const e = easeStandard(p);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    k: Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e),
  };
}

/** Do two cameras describe the same view? Used by the Esc-restores-exactly test. */
export function sameCamera(a: CameraState, b: CameraState, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.k - b.k) < epsilon;
}
