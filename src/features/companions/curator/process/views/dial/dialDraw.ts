import { clamp, lerp } from './dialFormat';
import { colorOf, dimFor, sweepA, tickPose, TAU, type Geo, type Layers, type Paint } from './dialGeo';
import { TICKS, tickType, type RepoArc, type Ring } from './dialModel';
import { rgba, type Palette, type Rgb } from './dialPalette';

/**
 * The instrument layer: field, bezel, rings, ruler marks - a pure function of (geometry, paint,
 * palette). It runs only when something it shows changed (hover, intro sweep, camera tween,
 * resize), never per pointer move.
 */
function drawField(c: CanvasRenderingContext2D, g: Geo, p: Paint, pal: Palette) {
  const fade = 1 - p.camU;
  c.lineWidth = 1;
  c.strokeStyle = rgba(pal.fg, 0.04 * (1 - p.camU * 0.6));
  c.beginPath();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU + 0.02;
    const r1 = g.R * (i % 6 === 0 ? 2.8 : 1.5);
    c.moveTo(g.cx + Math.cos(a) * g.R * 1.08, g.cy + Math.sin(a) * g.R * 1.08);
    c.lineTo(g.cx + Math.cos(a) * r1, g.cy + Math.sin(a) * r1);
  }
  c.stroke();
  [1.16, 1.5, 2.0, 2.6].forEach((m, k) => {
    c.strokeStyle = rgba(pal.accent, 0.07 - k * 0.012);
    c.beginPath(); c.arc(g.cx, g.cy, g.R * m, 0, TAU); c.stroke();
  });
  const tc = p.tint ?? pal.accent;
  const hg = c.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.inn * 1.5);
  hg.addColorStop(0, rgba(tc, 0.2 * fade));
  hg.addColorStop(1, rgba(tc, 0));
  c.fillStyle = hg;
  c.beginPath(); c.arc(g.cx, g.cy, g.inn * 1.5, 0, TAU); c.fill();
  c.strokeStyle = rgba(pal.fg, 0.1 * fade);
  c.beginPath(); c.arc(g.cx, g.cy, g.hub, 0, TAU); c.stroke();
}

function drawBezel(c: CanvasRenderingContext2D, g: Geo, p: Paint, pal: Palette, arcs: RepoArc[]) {
  const fa = 1 - p.camU;
  if (fa <= 0.01) return;
  const rM = g.R - g.bz / 2;
  arcs.forEach((A, k) => {
    const vis = clamp((p.reveal * 1.5 - 0.5 - (A.a0 / 360) * 0.55) / 0.12, 0, 1);
    if (vis <= 0) return;
    const hov = p.hoverRepo === k;
    const sel = p.repo === A.name;
    const dim = p.repo && !sel ? 0.38 : 1;
    const grow = hov || sel ? g.bz * 0.45 : 0;
    const parts: [number, Rgb][] = [[A.landed, pal.accent], [A.quiet, pal.quiet], [A.interrupted, pal.warn], [A.errored, pal.err]];
    let a = A.a0;
    const tot = Math.max(1, A.n);
    for (const [count, col] of parts) {
      if (!count) continue;
      const sp = (A.span * count) / tot;
      c.beginPath();
      c.arc(g.cx, g.cy, rM + grow / 2, ((a - 90) / 360) * TAU, ((a + sp - 90) / 360) * TAU);
      a += sp;
      c.lineWidth = g.bz + grow;
      c.lineCap = 'butt';
      c.strokeStyle = rgba(col, (hov || sel ? 0.98 : 0.72) * vis * dim * fa);
      c.stroke();
    }
    if (sel || hov) {
      c.beginPath();
      c.arc(g.cx, g.cy, g.R + grow + 5 * g.scl, ((A.a0 - 90) / 360) * TAU, ((A.a1 - 90) / 360) * TAU);
      c.lineWidth = 2 * g.scl;
      c.strokeStyle = rgba(pal.fg, 0.9 * fa);
      c.stroke();
    }
  });
}

function strokeTick(c: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, len: number) {
  c.beginPath();
  c.moveTo(x - (dx * len) / 2, y - (dy * len) / 2);
  c.lineTo(x + (dx * len) / 2, y + (dy * len) / 2);
  c.stroke();
}

function drawRing(c: CanvasRenderingContext2D, g: Geo, p: Paint, pal: Palette, rg: Ring, nSt: number) {
  const q = rg.q;
  const rulerW = Math.max(2, ((g.ruler.x1 - g.ruler.x0) / TICKS) * 0.62);
  const hovq = p.hover === q || (p.level >= 1 && p.camQ === q);
  const lwP = Math.max(1.7, ((TAU * g.rMid[q]!) / TICKS) * 0.56);
  // pass 1: the glow under the lit ticks
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < rg.lit; i++) {
    const sa = sweepA(p.reveal, q, i);
    if (sa <= 0) continue;
    const type = tickType(rg, i);
    const d = dimFor(p, nSt, q, type) * sa;
    if (d < 0.05) continue;
    const ps = tickPose(g, p, q, i);
    c.strokeStyle = rgba(colorOf(pal, type), (hovq ? 0.17 : 0.085) * d);
    c.lineWidth = lerp(lwP, rulerW, ps.u) * 2.6;
    strokeTick(c, ps.x, ps.y, ps.dx, ps.dy, ps.len);
  }
  c.globalCompositeOperation = 'source-over';
  // pass 2: the ticks, then the hollow dots for the sessions that never got there
  for (let i = 0; i < TICKS; i++) {
    const sa = sweepA(p.reveal, q, i);
    if (sa <= 0) continue;
    const ty = i < rg.lit ? tickType(rg, i) : 4;
    const hollow = (p.hover != null && p.hover !== q && p.level === 0 ? 0.4 : p.level >= 1 && q !== p.camQ ? 1 - p.camU : 1) * (p.outcome ? 0.3 : 1);
    const dd = (ty === 4 ? hollow : dimFor(p, nSt, q, ty)) * sa;
    if (dd < 0.04) continue;
    const ps = tickPose(g, p, q, i);
    if (ty === 4) {
      c.fillStyle = rgba(pal.mf, 0.42 * dd);
      c.beginPath(); c.arc(ps.x, ps.y, lerp(1.2, 1.9, ps.u) * g.scl, 0, TAU); c.fill();
      continue;
    }
    c.strokeStyle = rgba(colorOf(pal, ty), (ty === 1 ? 0.78 : 0.96) * dd);
    c.lineWidth = lerp(lwP, rulerW, ps.u) * (hovq ? 1.18 : 1);
    strokeTick(c, ps.x, ps.y, ps.dx, ps.dy, ps.len);
  }
  // stumbles: an amber hairline along the ring
  const fa = (p.level >= 1 && q !== p.camQ ? 1 - p.camU : 1) * (q === p.camQ ? 1 - p.camU : 1) * (p.hover != null && p.hover !== q && p.level === 0 ? 0.4 : 1);
  if (rg.stum > 0 && fa > 0.02) {
    const an = clamp((p.reveal * 1.5 - 0.7 - q * 0.05) / 0.3, 0, 1);
    c.save();
    c.setLineDash([2 * g.scl, 3.2 * g.scl]);
    c.lineWidth = 1.7 * g.scl;
    c.strokeStyle = rgba(pal.warn, 0.85 * fa * an);
    c.beginPath();
    c.arc(g.cx, g.cy, g.rMid[q]! + g.th / 2 + 4.2 * g.scl, -Math.PI / 2, -Math.PI / 2 + (TAU * rg.stum * an) / TICKS);
    c.stroke();
    c.restore();
  }
  // the whole mode behind a picked repository: a bright tick where its arc would end
  if (p.repo && fa > 0.02) {
    const ang = -Math.PI / 2 + TAU * rg.cohort;
    const r0 = g.rMid[q]! - g.th / 2 - 5 * g.scl;
    const r1 = g.rMid[q]! + g.th / 2 + 5 * g.scl;
    c.strokeStyle = rgba(pal.fg, 0.95 * fa);
    c.lineWidth = 2.4 * g.scl;
    c.beginPath();
    c.moveTo(g.cx + Math.cos(ang) * r0, g.cy + Math.sin(ang) * r0);
    c.lineTo(g.cx + Math.cos(ang) * r1, g.cy + Math.sin(ang) * r1);
    c.stroke();
    c.save();
    c.setLineDash([3 * g.scl, 4 * g.scl]);
    c.strokeStyle = rgba(pal.fg, 0.35 * fa);
    c.lineWidth = 1;
    c.beginPath(); c.arc(g.cx, g.cy, g.rMid[q]! - g.th / 2 - 2 * g.scl, -Math.PI / 2, ang); c.stroke();
    c.restore();
  }
}

function drawRulerMarks(c: CanvasRenderingContext2D, g: Geo, p: Paint, pal: Palette, rings: Ring[], a: number) {
  const rg = rings[p.camQ];
  if (!rg) return;
  const { x0, x1, y, h } = g.ruler;
  const w = x1 - x0;
  const lit = x0 + (w * rg.lit) / TICKS;
  const top = y - h / 2 - 9 * g.scl;
  const bot = y + h / 2 + 9 * g.scl;
  c.strokeStyle = rgba(pal.fg, 0.55 * a);
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x0, top + 5); c.lineTo(x0, top); c.lineTo(lit, top); c.lineTo(lit, top + 5); c.stroke();
  if (rg.stum > 0) {
    c.strokeStyle = rgba(pal.warn, 0.9 * a);
    c.lineWidth = 2;
    c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(x0, bot); c.lineTo(x0 + (w * rg.stum) / TICKS, bot); c.stroke();
    c.setLineDash([]);
  }
  if (p.repo) {
    const xc = x0 + w * rg.cohort;
    c.strokeStyle = rgba(pal.fg, 0.95 * a);
    c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(xc, top - 6); c.lineTo(xc, bot - 3); c.stroke();
  }
}

export function drawStatic(c: CanvasRenderingContext2D, g: Geo, p: Paint, pal: Palette, layers: Layers) {
  c.clearRect(0, 0, g.W, g.H);
  c.lineCap = 'round';
  drawField(c, g, p, pal);
  drawBezel(c, g, p, pal, layers.arcs);
  c.lineCap = 'round';
  for (const rg of layers.rings) drawRing(c, g, p, pal, rg, layers.rings.length);
  // a staircase: where one ring's arc ends, the next ring's lit arc ends too
  c.lineWidth = 1;
  c.strokeStyle = rgba(pal.fg, 0.22 * (1 - p.camU));
  for (let k = 0; k < layers.rings.length - 1; k++) {
    const a2 = -Math.PI / 2 + (TAU * layers.rings[k]!.t[0]) / TICKS;
    const ra = g.rMid[k]! - g.th / 2;
    const rb = g.rMid[k + 1]! + g.th / 2;
    c.beginPath();
    c.moveTo(g.cx + Math.cos(a2) * ra, g.cy + Math.sin(a2) * ra);
    c.lineTo(g.cx + Math.cos(a2) * rb, g.cy + Math.sin(a2) * rb);
    c.stroke();
  }
  if (p.camU > 0.6) drawRulerMarks(c, g, p, pal, layers.rings, (p.camU - 0.6) / 0.4);
}
