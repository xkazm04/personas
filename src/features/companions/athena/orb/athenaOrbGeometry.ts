/**
 * Where the orb is, and where things dock against it.
 *
 * Position is stored as VIEWPORT FRACTIONS (`companionOrbPos`) rather than
 * pixels, so it survives window resizes and app restarts; everything here is
 * the conversion in both directions plus the shared constants every surface
 * that docks to the orb (decision bubble, unread bubble, guide caption) needs.
 */

import { useEffect, useState } from 'react';

/** Diameter of the orb in px. Imported widely — bubbles measure against it. */
export const ORB_SIZE = 60;

/** Minimum distance the orb keeps from any viewport edge. */
export const MARGIN = 16;

/** Gap between the orb and a bubble docked above it. */
export const BUBBLE_GAP = 12;

export interface Viewport {
  w: number;
  h: number;
}

export function readViewport(): Viewport {
  return { w: window.innerWidth, h: window.innerHeight };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Resolve stored fractions → clamped top-left pixels for the current viewport. */
export function fractionToPx(x: number, y: number, vp: Viewport): { left: number; top: number } {
  const freeW = Math.max(vp.w - ORB_SIZE, 0);
  const freeH = Math.max(vp.h - ORB_SIZE, 0);
  return {
    left: clamp(x * freeW, MARGIN, freeW - MARGIN),
    top: clamp(y * freeH, MARGIN, freeH - MARGIN),
  };
}

/** Live viewport, re-read on resize. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => readViewport());
  useEffect(() => {
    const onResize = () => setVp(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

/** True when the orb sits on the left half — captions/badges flip to its right. */
export function isDockedLeft(left: number, viewportWidth: number): boolean {
  return left + ORB_SIZE / 2 < viewportWidth / 2;
}
