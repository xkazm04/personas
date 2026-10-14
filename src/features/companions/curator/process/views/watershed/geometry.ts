import type { SpineModel } from '../../engine/spine';
import { SEA_ORDER, type Fates, type SeaOutcome } from './fates';
import { clamp, seedOf, smooth, type Pt } from './noise';

/** Text width in px for a string at a size, weight and tracking (em). Injected so this stays pure. */
export type Measure = (text: string, px: number, weight?: number, trackEm?: number) => number;

export interface Blob { type: 'lake' | 'marsh'; q: number; c: number; cx: number; cy: number; r: number; rx: number; ry: number; w: number; p0: Pt; p1: Pt; p2: Pt; p3: Pt }
export interface Mouth { o: SeaOutcome; cnt: number; w: number; ya: number; yb: number; ys: number }
export interface PlateBox { q: number; left: number; top: number; width: number }

export interface GeoInput {
  W: number;
  H: number;
  /** The map's type size before scaling (the app's body step), px. */
  fs: number;
  model: SpineModel;
  fates: Fates;
  /** Seeds the river's meander so a mode and a repository keep their own shape. */
  seed: string;
  /** A repository is picked: plates carry one more line (its share of the whole mode). */
  picked: boolean;
  cartTitle: string;
  cartSub: string;
  /** The widest form of the conservation line, to decide whether the title zone stacks. */
  scaleProbe: string;
  measure: Measure;
}

export interface Geo {
  W: number; H: number; U: number; fs: number; N: number; n: number;
  xA: number; xB: number; sp: number; tiers: 1 | 2; x: number[]; dx: number[];
  plateH: number; Tz: number; Mb: number; srcW: number; k: number; cy: number; Lt: number;
  stacked: boolean; cartW: number;
  cClean: number[]; cFail: number[];
  yc: (x: number) => number; top: (x: number) => number; bot: (x: number) => number;
  laneY: (lane: number, x: number) => number;
  /** Width the departures at stations have taken off a bank by x, for any departure counts. */
  cum: (x: number, arr: number[]) => number;
  blobs: Blob[]; mouths: Mouth[]; xM: number; headY: number; plates: PlateBox[];
  ranks: Record<number, number>;
}

/**
 * Lay the map out for one stage size. Everything the drawing, the labels, the plates, the flow and
 * the camera need is computed here once per (model, size) and never on hover.
 */
export function computeGeo(inp: GeoInput): Geo {
  const { W, H, model: m, fates: f, measure } = inp;
  const N = m.stations.length, n = m.n;
  const U = clamp(1 + (Math.min(W / 1280, H / 724) - 1) * 0.7, 1, 1.45);
  const fs = inp.fs * U;
  const T = fs / 16.5; // text-bound dimensions follow the type, map dimensions follow U
  const xA = Math.max(34 * U, W * 0.035);
  const xB = W * (W < 1200 ? 0.7 : 0.715);
  let sp = (xB - xA) / (N + 0.1);
  const tiers: 1 | 2 = sp >= 205 * T ? 1 : 2;
  let lead = 0.55;
  if (tiers === 2) { lead = 0.75; sp = (xB - xA) / (N + 0.75); }
  const x = Array.from({ length: N }, (_, i) => xA + sp * (i + lead));
  const plateH = (inp.picked ? 158 : 134) * T;
  const band = tiers * plateH + (tiers - 1) * 18 * U + 26 * U;
  const cartW = Math.max(measure(inp.cartTitle.toUpperCase(), fs * 1.15, 700, 0.26), measure(inp.cartSub, fs)) + 50 * U;
  const stacked = cartW + measure(inp.scaleProbe, fs) + 40 + 110 * U > W;
  const Tz = (stacked ? 124 : 74) * T;
  const Mb = H - band;
  const mh = Mb - Tz;
  const srcW = clamp(mh * 0.23, 52, 150 * U);
  const k = srcW / Math.max(1, n);
  const cy = Tz + mh * 0.46;
  const amp = Math.min(18 * U, mh * 0.045);
  const ph = ((seedOf(inp.seed) % 100) / 100) * 0.8;
  const yc = (px: number) => cy + amp * Math.sin(((px - xA) / sp) * 1.9 + 0.5 + ph) + amp * 0.35 * Math.sin(((px - xA) / sp) * 4.1 + 1.3);
  const Lt = 0.3 * sp;
  const dx = x.map((v) => v + 0.1 * sp);
  const cClean = f.clean.map((a) => a.length), cFail = f.fail.map((a) => a.length);
  const cum = (px: number, arr: number[]) => {
    let s = 0;
    for (let i = 0; i < N; i++) if (arr[i]) s += arr[i]! * smooth((px - dx[i]!) / Lt);
    return s;
  };
  const top = (px: number) => yc(px) - srcW / 2 + cum(px, cClean) * k;
  const bot = (px: number) => yc(px) + srcW / 2 - cum(px, cFail) * k;
  const laneY = (lane: number, px: number) => yc(px) - srcW / 2 + (lane + 0.5) * k;

  const ranks: Record<number, number> = {};
  m.worst.slice(0, 3).forEach((q, r) => { ranks[q] = r + 1; });

  const blobs: Blob[] = [];
  for (let q = 0; q < N; q++) {
    for (const [type, c] of [['lake', cClean[q]!], ['marsh', cFail[q]!]] as const) {
      if (!c) continue;
      const up = type === 'lake';
      const cx = x[q]! + 0.44 * sp;
      const bank = up ? top(cx) : bot(cx);
      const room = up ? bank - Tz : Mb - bank;
      const rmax = Math.max(8, (room - 64 * T) / 2);
      const r = clamp(Math.sqrt(c / n) * srcW * (up ? 0.85 : 1), 7, Math.min(rmax, 0.36 * sp));
      const gap = 20 * U;
      const cyb = up ? bank - gap - r * 0.8 : bank + gap + r * 0.8;
      const x0 = dx[q]!;
      const w = Math.max(1.5, c * k);
      const before = up ? top(x0 - 2) : bot(x0 - 2);
      const y0 = up ? before + w / 2 : before - w / 2;
      blobs.push({ type, q, c, cx, cy: cyb, r, rx: r * 1.35, ry: r * 0.8, w,
        p0: [x0, y0], p1: [x0 + 0.18 * sp, y0], p2: [cx - 0.12 * sp, cyb + (up ? 1 : -1) * (r * 0.8 + 10)], p3: [cx, cyb] });
    }
  }

  const xM = xB + (W - xB) * 0.22;
  const slots = SEA_ORDER.length, top0 = Tz + 64 * T, bot0 = H - 18 * U;
  const spacing = Math.min(124 * T, (bot0 - top0) / slots);
  const mid = clamp(cy, top0 + (spacing * slots) / 2, bot0 - (spacing * slots) / 2);
  const mouths = SEA_ORDER.map((o, si) => {
    const cnt = f.sea[o].length, w = cnt * k;
    const ya = laneY(f.seaStart[o], xB) - k / 2;
    return { o, cnt, w, ya, yb: ya + w, ys: mid - (spacing * slots) / 2 + spacing * (si + 0.5) };
  });
  const headY = mid - (spacing * slots) / 2 - 14 * T;

  const pw = tiers === 1 ? sp - 14 * U : 2 * sp - 20 * U;
  const plates = x.map((px, q) => ({
    q,
    width: pw,
    left: clamp(px - pw / 2, 8, W - 8 - pw),
    top: Mb + 18 * U + (tiers === 1 ? 0 : q % 2) * (plateH + 18 * U),
  }));

  return { W, H, U, fs, N, n, xA, xB, sp, tiers, x, dx, plateH, Tz, Mb, srcW, k, cy, Lt, stacked, cartW,
    cClean, cFail, yc, top, bot, laneY, cum, blobs, mouths, xM, headY, plates, ranks };
}
