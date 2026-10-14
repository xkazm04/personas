import type { SpineModel } from '../../engine/spine';
import type { Blob, Geo } from './geometry';
import { f1, hash, vnoise, type Pt } from './noise';

/** The map's SVG path data, built once per geometry. Pure strings: no DOM, no React. */

const STEP = 3;

function trace(g: Geo, fn: (x: number) => number, from = g.xA, to = g.xB + 1, step = STEP): string {
  let d = '';
  for (let x = from; x <= to; x += step) d += (d ? 'L' : 'M') + f1(x) + ' ' + f1(fn(x));
  return d;
}

export function riverPaths(g: Geo) {
  let back = '';
  for (let x = g.xB + 1; x >= g.xA; x -= STEP) back += 'L' + f1(x) + ' ' + f1(g.bot(x));
  const topEdge = trace(g, g.top);
  return {
    body: topEdge + back + 'Z',
    top: topEdge,
    bottom: trace(g, g.bot),
  };
}

/** The river's centre line as points, for the flowing current the canvas draws. */
export function midline(g: Geo): Pt[] {
  const pts: Pt[] = [];
  for (let x = g.xA; x <= g.xB + 1; x += 6) pts.push([x, (g.top(x) + g.bot(x)) / 2]);
  return pts;
}

/** Amber rapids just upstream of each settlement, denser where more sessions stumbled. */
export function rapids(g: Geo, m: SpineModel): { q: number; d: string; width: number; opacity: number }[] {
  const out: { q: number; d: string; width: number; opacity: number }[] = [];
  m.stations.forEach((s, q) => {
    if (!s.friction || !s.reached) return;
    const share = s.friction / s.reached, cnt = Math.round(3 + share * 8);
    const x0 = g.x[q]! - 0.3 * g.sp, x1 = g.x[q]! - 0.03 * g.sp;
    let d = '';
    for (let c = 0; c < cnt; c++) {
      const xx = x0 + ((x1 - x0) * (c + 0.5)) / cnt, t0 = g.top(xx) + 3, b0 = g.bot(xx) - 3;
      if (b0 - t0 < 4) continue;
      const jj = hash(c, q, 21) * 0.25;
      d += 'M' + f1(xx - 4) + ' ' + f1(t0 + (b0 - t0) * jj) + ' Q' + f1(xx + 4) + ' ' + f1((t0 + b0) / 2) + ' ' + f1(xx - 4) + ' ' + f1(b0 - (b0 - t0) * hash(c, q, 22) * 0.25);
    }
    if (d) out.push({ q, d, width: f1(1 + share * 0.8), opacity: f1(0.3 + share * 0.35) });
  });
  return out;
}

export const curve = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) =>
  'M' + p0.map(f1).join(' ') + ' C' + p1.map(f1).join(' ') + ' ' + p2.map(f1).join(' ') + ' ' + p3.map(f1).join(' ');

/** A wobbly closed outline (lake shore, marsh edge) through 22 noise-displaced points. */
export function blobPath(cx: number, cy: number, rx: number, ry: number, seed: number, wob: number): string {
  const k = 22;
  const pts: Pt[] = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2, f = 1 + wob * (vnoise(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6 + seed, 3) - 0.5);
    pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]);
  }
  let d = '';
  for (let j = 0; j < k; j++) {
    const p0 = pts[(j - 1 + k) % k]!, p1 = pts[j]!, p2 = pts[(j + 1) % k]!, p3 = pts[(j + 2) % k]!;
    if (!j) d += 'M' + f1(p1[0]) + ' ' + f1(p1[1]);
    d += ' C' + f1(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + f1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + f1(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + f1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f1(p2[0]) + ' ' + f1(p2[1]);
  }
  return d + 'Z';
}

export function reeds(b: Blob): string {
  let d = '';
  const nr = Math.round(6 + b.r / 3);
  for (let i = 0; i < nr; i++) {
    const a = (i / nr) * Math.PI * 2 + hash(i, b.q, 4) * 0.4, rr = 1.05 + hash(i, b.q, 5) * 0.25;
    const x = f1(b.cx + Math.cos(a) * b.rx * rr), y = f1(b.cy + Math.sin(a) * b.ry * rr + 4);
    d += `M${x} ${y}l-2.5 -6M${x} ${y}l0 -8M${x} ${y}l2.5 -6`;
  }
  return d;
}

/** A tapered band from one span to another: a delta channel. */
export function ribbon(x0: number, ya: number, yb: number, x1: number, y1a: number, y1b: number): string {
  const c = (x1 - x0) * 0.55;
  return 'M' + f1(x0) + ' ' + f1(ya) + ' C' + f1(x0 + c) + ' ' + f1(ya) + ' ' + f1(x1 - c) + ' ' + f1(y1a) + ' ' + f1(x1) + ' ' + f1(y1a) +
    ' L' + f1(x1) + ' ' + f1(y1b) + ' C' + f1(x1 - c) + ' ' + f1(y1b) + ' ' + f1(x0 + c) + ' ' + f1(yb) + ' ' + f1(x0) + ' ' + f1(yb) + 'Z';
}

export function seaPaths(g: Geo) {
  let coast = '';
  for (let y = -20; y <= g.H + 20; y += 6) coast += (y === -20 ? 'M' : 'L') + f1(g.xM + 6 * g.U + 5 * Math.sin(y / 23) + 3 * Math.sin(y / 7.3)) + ' ' + y;
  let waves = '';
  for (let i = 0; i < 26; i++) {
    const x = g.xM + 40 * g.U + hash(i, 3, 9) * (g.W - g.xM - 60 * g.U), y = g.Tz + hash(i, 5, 9) * (g.H - g.Tz);
    waves += 'M' + f1(x) + ' ' + f1(y) + ' q 5 -4 10 0 t 10 0';
  }
  return { coast, waves };
}

export function graticule(g: Geo): string {
  const step = 150 * g.U;
  let d = '';
  for (let x = -g.W; x < g.W * 2; x += step) d += 'M' + f1(x) + ' ' + -g.H + 'V' + g.H * 2;
  for (let y = -g.H; y < g.H * 2; y += step) d += 'M' + -g.W + ' ' + f1(y) + 'H' + g.W * 2;
  return d;
}

/** The whole mode's banks at the picked repository's scale, drawn dashed behind its river. */
export function ghostBanks(g: Geo, baseN: number, clean: number[], fail: number[]) {
  const k = g.srcW / Math.max(1, baseN);
  const t = (x: number) => g.yc(x) - g.srcW / 2 + g.cum(x, clean) * k;
  const b = (x: number) => g.yc(x) + g.srcW / 2 - g.cum(x, fail) * k;
  return { top: trace(g, t, g.xA, g.xB, 4), bottom: trace(g, b, g.xA, g.xB, 4) };
}
