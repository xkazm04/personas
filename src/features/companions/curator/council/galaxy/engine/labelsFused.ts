// The fused profile's label pass: a label never covers a node.
//
// Ported from the round-2 Bezel's field engine (`galaxy-core.js`, the
// occupancy pass the owner named in the fusion). Every star and technique
// dot on screen is an OBSTACLE. A name is offered eight spots round its node,
// preferred side first; a long name is also offered as two lines; a name
// with no free spot falls back to its rank number (the number the list and
// the dial print); and only when even the number has no room is the label
// counted as hidden. The count stays honest the way the classic pass keeps
// it: an anchor outside the stage (or outside the bezel's glass) was never
// something the reader could have read, so it is not a candidate at all.
import type { LabelRequest, Rect } from './labels';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** A top-left box, the shape every candidate spot is expressed in. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

/** The glass the bezel mode frames the field in, or null for the full stage. */
export interface LabelWindow {
  x: number;
  y: number;
  r: number;
}

export interface FusedPlacement {
  req: LabelRequest;
  box: Box;
  /** Two lines when the name only fitted wrapped. */
  lines: [string, string] | null;
  /** The name had no room; its rank number stands in for it. */
  numberOnly: boolean;
}

export const LINE_H = 20;
export const TWO_LINE_H = 36;
export const NUMBER_FONT_PX = 13;

/** Eight spots round a node at distance `off`, preferred side first. */
export function around(x: number, y: number, w: number, h: number, off: number, side: Side = 'right'): Box[] {
  const R = { x: x + off, y: y - h / 2, w, h };
  const Lf = { x: x - off - w, y: y - h / 2, w, h };
  const B = { x: x - w / 2, y: y + off, w, h };
  const T = { x: x - w / 2, y: y - off - h, w, h };
  const d = off * 0.72;
  const RB = { x: x + d, y: y + d - 2, w, h };
  const RT = { x: x + d, y: y - d - h + 2, w, h };
  const LB = { x: x - d - w, y: y + d - 2, w, h };
  const LT = { x: x - d - w, y: y - d - h + 2, w, h };
  if (side === 'left') return [Lf, LT, LB, T, B, R, RT, RB];
  if (side === 'top') return [T, RT, LT, R, Lf, B, RB, LB];
  if (side === 'bottom') return [B, RB, LB, R, Lf, T, RT, LT];
  return [R, RT, RB, Lf, LT, LB, T, B];
}

/** The narrowest split of a name into two lines, if it is narrower than `maxW`. */
export function wrap2(text: string, measure: (s: string) => number, maxW: number): { a: string; b: string; w: number } | null {
  const words = text.split(' ');
  if (words.length < 2) return null;
  let best: { a: string; b: string; w: number } | null = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(measure(a), measure(b));
    if (!best || w < best.w) best = { a, b, w };
  }
  return best && best.w <= maxW ? best : null;
}

const toRect = (b: Box): Rect => ({ a: b.x, b: b.y, c: b.x + b.w, d: b.y + b.h });

function hitsCircle(b: Box, c: Circle): boolean {
  const nx = Math.max(b.x, Math.min(c.x, b.x + b.w));
  const ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
  return (nx - c.x) * (nx - c.x) + (ny - c.y) * (ny - c.y) < c.r * c.r;
}

function insideWindow(b: Box, win: LabelWindow): boolean {
  const corners: Array<[number, number]> = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
  return corners.every(([x, y]) => Math.hypot(x - win.x, y - win.y) < win.r - 4);
}

/**
 * Place what fits, count what the view could have named and did not.
 * `measure(text, size, weight)` stands in for `ctx.measureText` so the pass
 * is testable without a canvas.
 */
export function placeFused(
  requests: LabelRequest[],
  measure: (text: string, size: number, weight: number) => number,
  width: number,
  bottom: number,
  reserved: Rect[],
  obstacles: Circle[],
  win: LabelWindow | null = null,
): { placed: FusedPlacement[]; dropped: number; candidates: number; numbered: number } {
  const used: Rect[] = reserved.slice();
  const placed: FusedPlacement[] = [];
  let dropped = 0;
  let candidates = 0;
  let numbered = 0;
  const fits = (b: Box): boolean => {
    if (b.x < 4 || b.y < 4 || b.x + b.w > width - 4 || b.y + b.h > bottom - 4) return false;
    if (win && !insideWindow(b, win)) return false;
    const r = toRect(b);
    for (const u of used) if (r.a < u.c && r.c > u.a && r.b < u.d && r.d > u.b) return false;
    for (const c of obstacles) if (hitsCircle(b, c)) return false;
    return true;
  };
  const take = (req: LabelRequest, box: Box, lines: [string, string] | null, numberOnly: boolean) => {
    used.push(toRect(box));
    placed.push({ req, box, lines, numberOnly });
  };
  for (const req of requests.slice().sort((p, q) => p.priority - q.priority)) {
    const anchor = req.anchor;
    const ax = anchor ? anchor.x : req.x;
    const ay = anchor ? anchor.y : req.y;
    if (ax < 0 || ax > width || ay < 0 || ay > bottom) continue;
    if (win && Math.hypot(ax - win.x, ay - win.y) > win.r - 6) continue;
    candidates += 1;
    const m = (s: string) => measure(s, req.size, req.weight);
    const hasCaption = Boolean(req.caption);
    const h = hasCaption ? 40 : LINE_H;
    const w = Math.max(m(req.text), req.caption ? measure(req.caption.text, req.caption.size, req.caption.weight) : 0) + (hasCaption ? 8 : 6);
    const off = anchor?.off ?? 0;
    const side = anchor?.side ?? 'right';
    const cands: Array<{ box: Box; lines: [string, string] | null }> = [];
    if (anchor?.centre) cands.push({ box: { x: ax - w / 2, y: ay - h / 2, w, h }, lines: null });
    for (const box of around(ax, ay, w, h, off, side)) cands.push({ box, lines: null });
    if (!hasCaption && w > 110) {
      const two = wrap2(req.text, m, anchor?.maxW ?? w);
      if (two && two.w + 6 < w) {
        for (const box of around(ax, ay, two.w + 6, TWO_LINE_H, off, side)) cands.push({ box, lines: [two.a, two.b] });
      }
    }
    const hit = cands.find((c) => fits(c.box));
    if (hit) {
      take(req, hit.box, hit.lines, false);
      continue;
    }
    if (req.rank == null) {
      dropped += 1;
      continue;
    }
    const nw = measure(String(req.rank), NUMBER_FONT_PX, 700) + 6;
    const numberBox = around(ax, ay, nw, 18, Math.max(4, off - 3), side).find((b) => fits(b));
    if (numberBox) {
      numbered += 1;
      take(req, numberBox, null, true);
      continue;
    }
    dropped += 1;
  }
  return { placed, dropped, candidates, numbered };
}
