// PORTED from bp src/lib/train/pixels.ts (the change map's pixel maths). Pure and dependency free, so the worker
// (ui/compare/changeMap.worker.ts), the main-thread fallback and the tests run the same code. EDIT (port): indexed reads
// go through `at()` for noUncheckedIndexedAccess; the words are returned as data (pixFacts) and phrased by the panel
// in the sheet's language instead of bp's English sentences.
// Thresholds are bp's: a change of more than 3 of 255 levels "moved" (encoder noise stays under it), more than 24 is visible.

export const GRID_W = 32;
export const GRID_H = 18;
/** A channel change at or below this is noise: not drawn, not counted as moved. */
export const NOISE = 3;
/** A channel change above this is visible to a person. */
export const VISIBLE = 24;

/** One pair's change map: `cells` (row-major, GRID_W x GRID_H) hold the largest channel change in the cell. */
export interface PixGrid {
  w: number;
  h: number;
  cells: number[];
  /** % of pixels that changed by more than VISIBLE levels. */
  pct: number;
  /** % of pixels that changed by more than NOISE levels. */
  moved: number;
  /** The largest channel change anywhere, 0..255. */
  maxd: number;
  bbox?: [number, number, number, number];
}

/** Compare two RGBA buffers drawn at the same width and height. */
export function diffPixels(a: ArrayLike<number>, b: ArrayLike<number>, w: number, h: number): PixGrid {
  const cells = new Array<number>(GRID_W * GRID_H).fill(0);
  const at = (x: ArrayLike<number>, i: number): number => x[i] ?? 0;
  let moved = 0, vis = 0, maxd = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / h)) * GRID_W;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(at(a, i) - at(b, i)), Math.abs(at(a, i + 1) - at(b, i + 1)), Math.abs(at(a, i + 2) - at(b, i + 2)), Math.abs(at(a, i + 3) - at(b, i + 3)));
      if (d > maxd) maxd = d;
      if (d <= NOISE) continue;
      moved++;
      if (d > VISIBLE) vis++;
      const c = gy + Math.min(GRID_W - 1, Math.floor((x * GRID_W) / w));
      if (d > (cells[c] ?? 0)) cells[c] = d;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const n = Math.max(1, w * h), g: PixGrid = { w, h, cells, pct: (vis / n) * 100, moved: (moved / n) * 100, maxd };
  if (x1 >= 0) g.bbox = [x0, y0, x1, y1];
  return g;
}

/** What the panel says of a pair (bp pixWords, as data): identical, visually identical (under 0.2 % visible), or differ. */
export type PixFacts =
  | { kind: 'identical'; same: true; maxd: number }
  | { kind: 'near'; same: true; moved: number; maxd: number }
  | { kind: 'differ'; same: false; pct: number; maxd: number; box?: [number, number, number, number] };

export function pixFacts(g: PixGrid): PixFacts {
  if (g.moved === 0) return { kind: 'identical', same: true, maxd: Math.max(1, g.maxd) };
  if (g.pct < 0.2) return { kind: 'near', same: true, moved: g.moved, maxd: g.maxd };
  return g.bbox ? { kind: 'differ', same: false, pct: g.pct, maxd: g.maxd, box: g.bbox } : { kind: 'differ', same: false, pct: g.pct, maxd: g.maxd };
}

/** The bbox in grid units (the SVG overlay's viewBox is GRID_W x GRID_H). */
export function bboxCells(g: PixGrid): { x: number; y: number; w: number; h: number } | undefined {
  if (!g.bbox) return undefined;
  const [x0, y0, x1, y1] = g.bbox, sx = GRID_W / g.w, sy = GRID_H / g.h;
  return { x: x0 * sx, y: y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy };
}
