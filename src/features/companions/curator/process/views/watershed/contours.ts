import type { Geo } from './geometry';
import { clamp, f1, fbm, seedOf } from './noise';

type P = [number, number];

/**
 * The land's contour lines: marching squares over a noise height field whose valley follows the
 * river. Every fourth level is an index contour, drawn a little stronger. Returns two path strings,
 * so the whole relief is two SVG elements however many segments it holds.
 */
export function contours(g: Geo, mode: string): { regular: string; index: string } {
  const cell = 16 * g.U, x0 = -g.W * 0.15, x1 = g.W * 1.15, y0 = -20, y1 = g.H + 180;
  const nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell), sd = seedOf(mode) + 11;
  const F = new Float32Array((nx + 1) * (ny + 1));
  const scale = 230 * g.U;
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cell;
    const ycx = g.yc(clamp(x, g.xA, g.W));
    for (let j = 0; j <= ny; j++) {
      const y = y0 + j * cell;
      const valley = Math.min(1.3, Math.abs(y - ycx) / (g.H * 0.5));
      F[j * (nx + 1) + i] = fbm(x / scale, y / scale, sd) * 0.75 + valley * 0.95;
    }
  }
  const reg: string[] = [], idx: string[] = [];
  let li = 0;
  for (let lv = 0.42; lv < 1.9; lv += 0.085, li++) {
    const out = li % 4 === 0 ? idx : reg;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = F[j * (nx + 1) + i]!, b = F[j * (nx + 1) + i + 1]!, c = F[(j + 1) * (nx + 1) + i + 1]!, d = F[(j + 1) * (nx + 1) + i]!;
        const code = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const X = x0 + i * cell, Y = y0 + j * cell;
        const Tp: P = [X + (cell * (lv - a)) / (b - a), Y];
        const R: P = [X + cell, Y + (cell * (lv - b)) / (c - b)];
        const B: P = [X + (cell * (lv - d)) / (c - d), Y + cell];
        const L: P = [X, Y + (cell * (lv - a)) / (d - a)];
        const segs = SEGS[code]!(Tp, R, B, L);
        for (let s = 0; s < segs.length; s += 2) out.push('M' + f1(segs[s]![0]) + ' ' + f1(segs[s]![1]) + 'L' + f1(segs[s + 1]![0]) + ' ' + f1(segs[s + 1]![1]));
      }
    }
  }
  return { regular: reg.join(''), index: idx.join('') };
}

const SEGS: Record<number, (T: P, R: P, B: P, L: P) => P[]> = {
  1: (_T, _R, B, L) => [L, B], 2: (_T, R, B) => [B, R], 3: (_T, R, _B, L) => [L, R], 4: (T, R) => [T, R],
  5: (T, R, B, L) => [L, T, B, R], 6: (T, _R, B) => [T, B], 7: (T, _R, _B, L) => [L, T], 8: (T, _R, _B, L) => [L, T],
  9: (T, _R, B) => [T, B], 10: (T, R, B, L) => [L, B, T, R], 11: (T, R) => [T, R], 12: (_T, R, _B, L) => [L, R],
  13: (_T, R, B) => [B, R], 14: (_T, _R, B, L) => [L, B],
};
