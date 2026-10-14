import { clamp } from './dialFormat';
import { sweepA, TAU, type Geo, type Paint } from './dialGeo';
import { TICKS, type Ring } from './dialModel';
import type { Palette } from './dialPalette';

/**
 * The light layer: a pulse travels each ring's "went on" arc, and where sessions ended failing it
 * sheds embers. This is the only thing that moves while the figure sits idle, so it lives on its
 * own canvas and in its own rAF loop (stopped when hidden, off-path, or under reduced motion).
 */
export interface Pulse { q: number; a: number; v: number }
export interface Spark { x: number; y: number; vx: number; vy: number; t: number; l: number; o: 'errored' | 'interrupted' }

/** One pulse per six lit ticks of the "went on" arc (at most eight a ring); speeds are fixed per index so a rebuild is stable. */
export function makePulses(rings: Ring[]): Pulse[] {
  const out: Pulse[] = [];
  rings.forEach((rg, q) => {
    const n = clamp(Math.round(rg.t[0] / 6), 0, 8);
    for (let i = 0; i < n; i++) out.push({ q, a: ((i + 0.37) / n) * (rg.t[0] / TICKS), v: 0.06 + ((i * 0.618) % 1) * 0.05 + q * 0.004 });
  });
  return out;
}

export function drawFx(c: CanvasRenderingContext2D, g: Geo, p: Paint, pal: Palette, rings: Ring[], pulses: Pulse[], sparks: Spark[], dt: number, still: boolean) {
  c.clearRect(0, 0, g.W, g.H);
  const fa = 1 - p.camU;
  if (fa <= 0.02) return;
  c.globalCompositeOperation = 'lighter';
  for (const pu of pulses) {
    const rg = rings[pu.q];
    if (!rg || !rg.t[0]) continue;
    const endA = rg.t[0] / TICKS;
    if (!still) pu.a += pu.v * dt;
    if (pu.a >= endA) {
      if (!still && rg.t[2] + rg.t[3] > 0 && sparks.length < 90) {
        const ea = -Math.PI / 2 + TAU * endA;
        const rr = g.rMid[pu.q]!;
        for (let k = 0; k < 3; k++) {
          sparks.push({
            x: g.cx + Math.cos(ea) * rr, y: g.cy + Math.sin(ea) * rr,
            vx: Math.cos(ea) * (8 + Math.random() * 30) + (Math.random() - 0.5) * 16,
            vy: Math.sin(ea) * (8 + Math.random() * 30) + (Math.random() - 0.5) * 16,
            t: 0, l: 0.7 + Math.random() * 0.8, o: rg.t[2] >= rg.t[3] ? 'errored' : 'interrupted',
          });
        }
      }
      pu.a = 0;
    }
    const vis = sweepA(p.reveal, pu.q, Math.floor(pu.a * TICKS));
    if (vis <= 0) continue;
    const dimP = (p.hover != null && p.hover !== pu.q ? 0.3 : 1) * (p.outcome ? 0.2 : 1);
    for (let j = 0; j < 5; j++) {
      const aa = -Math.PI / 2 + TAU * Math.max(0, pu.a - j * 0.006);
      const r = (6.5 - j * 0.9) * g.scl;
      c.globalAlpha = (j === 0 ? 0.95 : 0.4 * (1 - j / 5)) * dimP * fa * vis;
      c.drawImage(pal.glow.accent, g.cx + Math.cos(aa) * g.rMid[pu.q]! - r, g.cy + Math.sin(aa) * g.rMid[pu.q]! - r, r * 2, r * 2);
    }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]!;
    s.t += dt;
    if (s.t > s.l) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.97; s.vy *= 0.97;
    const al = 1 - s.t / s.l;
    const r2 = 4.5 * g.scl * (0.5 + al * 0.6);
    c.globalAlpha = 0.85 * al * fa;
    c.drawImage(s.o === 'errored' ? pal.glow.err : pal.glow.warn, s.x - r2, s.y - r2, r2 * 2, r2 * 2);
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}
