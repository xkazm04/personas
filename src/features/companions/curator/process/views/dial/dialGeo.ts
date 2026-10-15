import { clamp, ease, lerp } from './dialFormat';
import { TICKS, type Ring } from './dialModel';
import type { RepoArc } from './dialModel';
import type { Palette, Rgb } from './dialPalette';

/** The dial's geometry and the paint state both canvas layers read. Pure data, no drawing. */
export const TAU = Math.PI * 2;

export interface Geo {
  W: number; H: number; cx: number; cy: number; R: number;
  bz: number; out: number; inn: number; pitch: number; th: number; hub: number;
  rMid: number[];
  /** stroke scale: 1 at the prototype's 1280x800 dial */
  scl: number;
  ruler: { x0: number; x1: number; y: number; h: number };
}

export interface Paint {
  hover: number | null;
  hoverRepo: number | null;
  repo: string | null;
  outcome: string | null;
  level: number;
  camQ: number;
  /** eased camera: 0 = the dial, 1 = ring camQ unrolled into the ruler */
  camU: number;
  /** intro sweep 0..1 */
  reveal: number;
  tint: Rgb | null;
}

export interface Layers { rings: Ring[]; arcs: RepoArc[] }

export function makeGeo(W: number, H: number, box: { cx: number; cy: number; w: number; h: number }, stations: number): Geo {
  const R = Math.max(80, Math.min(box.w, box.h) / 2 - 3);
  const out = R * 0.865;
  const inn = R * 0.45;
  const pitch = (out - inn) / Math.max(1, stations);
  const rMid: number[] = [];
  for (let q = 0; q < stations; q++) rMid.push(out - (q + 0.5) * pitch);
  return {
    W, H, cx: box.cx, cy: box.cy, R, bz: R * 0.075, out, inn, pitch, th: pitch * 0.66, hub: inn - pitch * 0.2, rMid,
    scl: clamp(R / 205, 0.7, 1.8),
    ruler: { x0: 0, x1: 0, y: 0, h: 40 },
  };
}

/** The intro sweep: ring q's tick i lights once the clockwise wave reaches it. */
export const sweepA = (reveal: number, q: number, i: number) => clamp((reveal * 1.55 - (q * 0.075 + (i / TICKS) * 0.55)) / 0.12, 0, 1);

export function colorOf(pal: Palette, type: number): Rgb {
  return type === 0 ? pal.accent : type === 1 ? pal.quiet : type === 2 ? pal.err : pal.warn;
}

/** How much a tick fades while something else is hovered, an outcome is previewed, or another ring is the one unrolled. */
export function dimFor(p: Paint, nSt: number, q: number, type: number): number {
  let d = 1;
  if (p.hover != null && p.hover !== q && p.level === 0) d *= 0.34;
  if (p.outcome) {
    const want = p.outcome === 'landed' ? q === nSt - 1 && type === 0 : p.outcome === 'quiet' ? type === 1 : p.outcome === 'errored' ? type === 2 : type === 3;
    if (!want) d *= 0.16;
  }
  if (p.level >= 1 && q !== p.camQ) d *= 1 - p.camU;
  return d;
}

export interface Pose { x: number; y: number; dx: number; dy: number; len: number; u: number }
const pose: Pose = { x: 0, y: 0, dx: 0, dy: 0, len: 0, u: 0 };

/** A tick's place: on its ring, or (for the ring the camera is unrolling) on its way to the ruler. Returns a shared scratch object. */
export function tickPose(g: Geo, p: Paint, q: number, i: number): Pose {
  const a = -Math.PI / 2 + ((i + 0.5) / TICKS) * TAU;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  pose.x = g.cx + ca * g.rMid[q]!;
  pose.y = g.cy + sa * g.rMid[q]!;
  pose.dx = ca; pose.dy = sa; pose.len = g.th; pose.u = 0;
  if (p.camU > 0 && q === p.camQ) {
    const ui = ease.inOutCubic(clamp(p.camU * 1.6 - (i / TICKS) * 0.6, 0, 1));
    const lx = g.ruler.x0 + ((i + 0.5) / TICKS) * (g.ruler.x1 - g.ruler.x0);
    pose.x = lerp(pose.x, lx, ui);
    pose.y = lerp(pose.y, g.ruler.y, ui);
    const dx = lerp(ca, 0, ui);
    const dy = lerp(sa, -1, ui);
    const dl = Math.hypot(dx, dy) || 1;
    pose.dx = dx / dl; pose.dy = dy / dl; pose.len = lerp(g.th, g.ruler.h, ui); pose.u = ui;
  }
  return pose;
}

/** Hit-test by math: the hub, a repository on the bezel, or a ring. */
export type Hit = { t: 'hub' } | { t: 'repo'; k: number } | { t: 'ring'; q: number } | null;
export function hitTest(g: Geo, arcs: RepoArc[], x: number, y: number): Hit {
  const dx = x - g.cx;
  const dy = y - g.cy;
  const r = Math.hypot(dx, dy);
  const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
  if (r < g.hub - 2) return { t: 'hub' };
  if (r > g.R - g.bz - 4 && r < g.R + g.bz * 0.9) {
    for (let k = 0; k < arcs.length; k++) if (ang >= arcs[k]!.a0 - 0.6 && ang <= arcs[k]!.a1 + 0.6) return { t: 'repo', k };
    return null;
  }
  for (let q = 0; q < g.rMid.length; q++) if (Math.abs(r - g.rMid[q]!) <= g.pitch / 2 + 1) return { t: 'ring', q };
  return null;
}
