import type { Geo } from './geometry';
import { clamp } from './noise';

export interface Cam { s: number; x: number; y: number }

/** The survey sheet's width at a stage width. */
export const sheetWidth = (W: number) => Math.round(clamp(W * 0.44, 420, 720));

/**
 * Where the camera sits for a depth: the whole map (0), one settlement framed beside the sheet
 * (1), or the whole river shrunk into the room left of the sheet as a locator for a voyage (2).
 * Applied as one CSS transform on the world, so the move is a composited transition.
 */
export function camFor(g: Geo, level: 0 | 1 | 2, station: number | null): Cam {
  if (level === 0 || (level === 1 && station == null)) return { s: 1, x: 0, y: 0 };
  const vpW = g.W - sheetWidth(g.W), vpH = g.H, pad = 28 * g.U;
  const R = level === 1
    ? { x: g.x[station!]! - 0.7 * g.sp, y: g.Tz - 6, w: 1.75 * g.sp, h: g.Mb - g.Tz + 12 }
    : { x: -10, y: g.Tz - 10, w: g.W + 20, h: g.Mb - g.Tz + 20 };
  const s = Math.min((vpW - pad * 2) / R.w, (vpH - pad * 2) / R.h, 1.85);
  return { s, x: (vpW - R.w * s) / 2 - R.x * s, y: (vpH - R.h * s) / 2 - R.y * s };
}
