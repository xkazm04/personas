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

/** The cubic used by every flight. */
export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * One step of a flight. Scale moves in log space; position moves linearly.
 * Exported so the tween is testable without a frame loop.
 */
export function tweenCamera(from: CameraState, to: CameraState, p: number): CameraState {
  const e = easeInOutCubic(Math.min(1, Math.max(0, p)));
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
