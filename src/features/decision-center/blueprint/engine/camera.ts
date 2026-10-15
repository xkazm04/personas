// The camera (PORTED from bp src/engine/camera.ts, with the prototype's level scales). World <-> screen, fits,
// fly-to with a pull-back bump, wheel zoom about the cursor, and the LEVEL CHAIN: the best-covered wing, room and
// bay under the view centre, and how deep the camera has entered (L0 site .. L3 bay).
//
// Level scales (the r3 defect #1): a fit alone lands a short wing at bay scale, so L1 and L2 stop at bp's own
// scale (LEVEL_K) and each level stays one STEP deeper than the one above it. That is what makes L1 show a wing
// among its neighbours and L2 a room inside its wing, and keeps the "entered" test unambiguous.
import type { Box, BayNode, Layout, PlaceNode, RoomNode, TileNode, WingNode } from '../model/layout';

export interface Pad { t: number; r: number; b: number; l: number }
export interface Safe { l: number; t: number; r: number; b: number }
export interface View { x: number; y: number; k: number }

export const PADS: Record<'bld' | 'wing' | 'room' | 'bay', Pad> = {
  bld: { t: 122, r: 20, b: 70, l: 20 }, wing: { t: 124, r: 26, b: 56, l: 26 }, room: { t: 22, r: 22, b: 56, l: 22 }, bay: { t: 30, r: 30, b: 56, l: 30 },
};
const OVER: Record<string, number> = { wing: 1.8, room: 1.3, bay: 1 };
export const LEVEL_K = { wing: 1.2, room: 1.5 } as const;
export const STEP = 1.2;
export const K_MIN = 0.02, K_MAX = 2.6;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

interface Anim { a: View; b: View; ms: number; t0: number; bump: number; zin: boolean; done?: () => void }
export type Chain = [WingNode | undefined, RoomNode | undefined, BayNode | undefined];

export class Camera implements View {
  x = 0; y = 0; k = 0.3;
  FW = 800; FH = 600;
  SAFE: Safe = { l: 0, t: 0, r: 800, b: 600 };
  HOME: View = { x: 0, y: 0, k: 0.3 };
  /** The scale of the whole-site fit; the LOD ramp is relative to it. */
  KB1 = 0.3;
  anim: Anim | null = null;
  /** Set whenever the view moved outside a step; the engine redraws and clears it. */
  moved = false;
  private lvK = new Map<PlaceNode, number>();
  private L: Layout;

  constructor(L: Layout) { this.L = L; }

  setLayout(L: Layout): void { this.L = L; this.lvK = new Map(); }

  /** Size of the canvas and the area the chrome leaves free; keeps the camera home when it was home. */
  resize(w: number, h: number, safe: Safe, first: boolean): void {
    this.FW = Math.max(200, w); this.FH = Math.max(200, h);
    this.SAFE = { l: safe.l, t: safe.t, r: this.FW - safe.r, b: this.FH - safe.b };
    const wasHome = this.near(this.HOME);
    this.HOME = this.fitCam(this.L.world, PADS.bld, 1);
    this.KB1 = this.HOME.k; this.lvK = new Map();
    if (wasHome || first) { this.x = this.HOME.x; this.y = this.HOME.y; this.k = this.HOME.k; }
  }

  sx = (x: number) => this.FW / 2 + (x - this.x) * this.k;
  sy = (y: number) => this.FH / 2 + (y - this.y) * this.k;
  wx = (x: number) => this.x + (x - this.FW / 2) / this.k;
  wy = (y: number) => this.y + (y - this.FH / 2) / this.k;
  rs = (o: Box) => ({ x: this.sx(o.x), y: this.sy(o.y), w: o.w * this.k, h: o.h * this.k });

  fitK(box: Box, pad: Pad, over = 1): number {
    const R = this.SAFE, rw = Math.max(80, R.r - pad.r - (R.l + pad.l)), rh = Math.max(80, R.b - pad.b - (R.t + pad.t));
    return clamp(Math.min(rw / box.w, (rh / box.h) * over), K_MIN, K_MAX);
  }
  fitCam(box: Box, pad: Pad, over = 1, kAt?: number): View {
    const R = this.SAFE, rx0 = R.l + pad.l, rx1 = R.r - pad.r, ry0 = R.t + pad.t, ry1 = R.b - pad.b, rh = Math.max(80, ry1 - ry0);
    const k = kAt ?? this.fitK(box, pad, over), h = Math.min(box.h, rh / k), sx = (rx0 + rx1) / 2, sy = (ry0 + ry1) / 2;
    return { x: box.x + box.w / 2 - (sx - this.FW / 2) / k, y: box.y + h / 2 - (sy - this.FH / 2) / k, k };
  }
  /** The view that frames a place at its level scale. */
  fitOf(o: WingNode | RoomNode | BayNode): View { return this.fitCam(o, PADS[o.kind], OVER[o.kind] ?? 1, this.fitKOf(o)); }
  /** The scale a level button flies to: the fit, held to bp's level scale and one STEP deeper than its parent's. */
  fitKOf(o: WingNode | RoomNode | BayNode): number {
    const hit = this.lvK.get(o);
    if (hit !== undefined) return hit;
    let k = this.fitK(o, PADS[o.kind], OVER[o.kind] ?? 1);
    const floor = this.HOME.k * 1.45;
    if (o.kind === 'wing') k = Math.max(Math.min(k, LEVEL_K.wing), floor);
    else if (o.kind === 'room') k = Math.max(Math.min(k, LEVEL_K.room), this.fitKOf(o.wing) * STEP);
    else k = Math.max(k, this.fitKOf(o.room) * STEP);
    k = clamp(k, K_MIN, K_MAX);
    this.lvK.set(o, k);
    return k;
  }

  clampToWorld(): void {
    const W = this.L.world, m = 120 / this.k;
    this.x = clamp(this.x, W.x - this.FW / 2 / this.k + m, W.x + W.w + this.FW / 2 / this.k - m);
    this.y = clamp(this.y, W.y - this.FH / 2 / this.k + m - 200 / this.k, W.y + W.h + this.FH / 2 / this.k - m);
  }
  reduced(): boolean { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  private set(v: View): void { this.x = v.x; this.y = v.y; this.k = v.k; this.moved = true; }
  flyTo(t: View, dur?: number, done?: () => void): void {
    const a = { x: this.x, y: this.y, k: this.k }, b = { x: t.x, y: t.y, k: clamp(t.k, K_MIN, K_MAX) };
    if (this.reduced() || dur === 0) { this.set(b); this.clampToWorld(); this.anim = null; done?.(); return; }
    const dist = Math.hypot(b.x - a.x, b.y - a.y) * Math.min(a.k, b.k) / this.FW, zr = Math.abs(Math.log(b.k / a.k));
    this.anim = { a, b, ms: dur || clamp(520 + dist * 260 + zr * 170, 520, 1150), t0: performance.now(), bump: clamp(dist * 0.45, 0, 0.9), zin: b.k > a.k, done };
  }
  near(t: View): boolean { return Math.abs(this.k / t.k - 1) < 0.06 && Math.hypot(this.x - t.x, this.y - t.y) * this.k < 40; }
  zoomAt(px: number, py: number, f: number): void {
    const wx = this.wx(px), wy = this.wy(py);
    this.anim = null;
    this.k = clamp(this.k * f, this.HOME.k * 0.7, K_MAX);
    this.x = wx - (px - this.FW / 2) / this.k; this.y = wy - (py - this.FH / 2) / this.k;
    this.clampToWorld();
    this.moved = true;
  }
  /** 0 = ribbons (site and wing), 1 = fixtures (room and deeper). */
  lod(k = this.k): number { return smooth(1.1, 1.65, k / this.KB1); }

  /** One animation step; true when the view moved. */
  step(now: number): boolean {
    const A = this.anim;
    if (!A) return false;
    const u = clamp((now - A.t0) / A.ms, 0, 1), ec = A.zin ? easeOut(u) : ease(u), ez = A.zin ? ease(u) : easeOut(u);
    this.k = Math.exp(Math.log(A.a.k) + (Math.log(A.b.k) - Math.log(A.a.k)) * ez) / (1 + A.bump * Math.sin(Math.PI * u));
    this.x = A.a.x + (A.b.x - A.a.x) * ec; this.y = A.a.y + (A.b.y - A.a.y) * ec;
    if (u >= 1) { this.set(A.b); this.anim = null; A.done?.(); }
    this.clampToWorld();
    return true;
  }

  // ---------------------------------------------------------------- the level chain (bp Engine.ts places/crumbs/levels)
  chain(): Chain {
    const cx = this.wx((this.SAFE.l + this.SAFE.r) / 2), cy = this.wy((this.SAFE.t + this.SAFE.b) / 2);
    const pick = <T extends Box>(list: readonly T[]): T | undefined => {
      let best: T | undefined, bd = Infinity;
      for (const o of list) {
        const dx = cx < o.x ? o.x - cx : cx > o.x + o.w ? cx - o.x - o.w : 0, dy = cy < o.y ? o.y - cy : cy > o.y + o.h ? cy - o.y - o.h : 0, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    };
    const W = pick(this.L.wings), R = W && pick(W.rooms), B = R && pick(R.bays);
    return [W, R, B];
  }
  entered(o: WingNode | RoomNode | BayNode): boolean { return this.k >= this.fitKOf(o) * 0.86 && this.k >= this.HOME.k * 1.18; }
  /** How deep the camera is (0 site .. 3 bay) and the places it is over. */
  level(): { n: number; chain: Chain } {
    const chain = this.chain();
    let n = 0;
    for (let i = 0; i < chain.length; i++) { const o = chain[i]; if (o && this.entered(o)) n = i + 1; else break; }
    return { n, chain };
  }
  goLevel(n: number, chain: Chain = this.chain()): void {
    if (n <= 0) { this.flyTo(this.HOME); return; }
    const o = chain[Math.min(n, 3) - 1];
    if (o) this.flyTo(this.fitOf(o));
  }
  chainOf(fid: string): Chain | null {
    const T: TileNode | undefined = this.L.TILE[fid];
    return T ? [T.wing, T.room, T.bay] : null;
  }
}
