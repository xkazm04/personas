// The bezel's dial, as numbers: every technique is one notch, so every arc is
// exactly the size of what it holds. Whatever the reader stands on takes at
// least 250 degrees and is turned under the lubber mark, so 12 o'clock is
// always where they are. Ported from the winner's `mapping` / `dialStep` /
// `sweep`; the numbers are the winner's.
import type { CategoryNode, DomainNode, GalaxyLayout, GalaxyNode, SubjectNode, TechniqueNode } from '../engine/types';

export type DialNode = DomainNode | CategoryNode | SubjectNode | TechniqueNode;

export interface DialIndex {
  total: number;
  span: Map<DialNode, [number, number]>;
  /** Inside out: techniques, subjects, categories, domains. */
  bands: [TechniqueNode[], SubjectNode[], CategoryNode[], DomainNode[]];
}

const INDEX = new WeakMap<GalaxyLayout, DialIndex>();

export function dialIndex(layout: GalaxyLayout): DialIndex {
  const hit = INDEX.get(layout);
  if (hit) return hit;
  const span = new Map<DialNode, [number, number]>();
  const bands: DialIndex['bands'] = [[], [], [], []];
  let u = 0;
  for (const d of layout.domains) {
    const d0 = u;
    for (const c of d.categories) {
      const c0 = u;
      for (const s of c.subjects) {
        const s0 = u;
        for (const t of s.techniques) {
          span.set(t, [u, u + 1]);
          bands[0].push(t);
          u += 1;
        }
        span.set(s, [s0, u]);
        bands[1].push(s);
      }
      span.set(c, [c0, u]);
      bands[2].push(c);
    }
    span.set(d, [d0, u]);
    bands[3].push(d);
  }
  const out = { total: u, span, bands };
  INDEX.set(layout, out);
  return out;
}

/** Degrees for every notch, for a focus and a pinned technique. */
export function mapAngles(ix: DialIndex, focus: GalaxyNode | null, pinned: TechniqueNode | null): Float64Array {
  const TOTAL = Math.max(1, ix.total);
  let base: (x: number) => number;
  const fs = focus ? ix.span.get(focus as DialNode) : undefined;
  if (!fs) base = (x) => -90 + (x / TOTAL) * 360;
  else {
    const [a, b] = fs;
    const width = Math.max(1, b - a);
    const PHI = Math.max((width / TOTAL) * 360, 250);
    base = (x) => {
      if (x >= a && x <= b) return -90 - PHI / 2 + ((x - a) / width) * PHI;
      const d = (((x - b) % TOTAL) + TOTAL) % TOTAL;
      return -90 + PHI / 2 + (d / Math.max(1, TOTAL - width)) * (360 - PHI);
    };
  }
  const ps = pinned ? ix.span.get(pinned) : undefined;
  const turn = ps ? -90 - base((ps[0] + ps[1]) / 2) : 0;
  const out = new Float64Array(TOTAL + 1);
  for (let i = 0; i <= TOTAL; i += 1) out[i] = base(i) + turn;
  return out;
}

const lerpAngle = (a: number, b: number, e: number) => a + (((((b - a) % 360) + 540) % 360) - 180) * e;

/**
 * The dial re-engraves on the camera's own curve: when a flight starts, every
 * notch departs from where it is drawn NOW, so a flight that interrupts
 * another never jumps.
 */
export class DialMotion {
  private from: Float64Array | null = null;

  private to: Float64Array | null = null;

  private flight = -1;

  now: Float64Array = new Float64Array(1);

  step(target: Float64Array, flightId: number, e: number): void {
    if (!this.to || this.to.length !== target.length) {
      this.to = target;
      this.from = target;
      this.now = Float64Array.from(target);
      this.flight = flightId;
      return;
    }
    if (flightId !== this.flight) {
      this.flight = flightId;
      this.from = Float64Array.from(this.now);
      this.to = target;
    }
    const from = this.from ?? target;
    // Kept in one turn, [-270, 90), so numbers never drift a revolution away.
    for (let i = 0; i < target.length; i += 1) {
      const v = lerpAngle(from[i] ?? 0, this.to[i] ?? 0, e);
      this.now[i] = ((((v + 270) % 360) + 360) % 360) - 270;
    }
  }

  angle(u: number): number {
    return this.now[u] ?? 0;
  }

  /** An arc's sweep, measured forward modulo one turn (never a whole ring). */
  sweep(span: [number, number]): number {
    const d = ((((this.angle(span[1]) - this.angle(span[0])) % 360) + 360) % 360);
    return d > 358 ? 0 : d;
  }
}

/** The glass for a free rect: centre, radius, and the scale the rim is drawn at. */
export function glassFor(v: { x0: number; x1: number; y0: number; y1: number }): { cx: number; cy: number; rp: number; sc: number } {
  const w = v.x1 - v.x0;
  const h = v.y1 - v.y0;
  const half = Math.min(w, h) / 2;
  const sc = Math.max(0.45, Math.min(1.2, (half - 70) / 240));
  return { cx: v.x0 + w / 2, cy: v.y0 + h / 2, rp: Math.max(60, half - 90 * sc), sc };
}

/** How the engine's usual frame fills its viewport, per level (0 sky .. 3). */
const USUAL_FILL = [0.93, 0.84, 0.88, 0.65];

/**
 * The frame fill that puts a focus inside the glass: 93% of the glass at the
 * sky, in a domain and in a category, 72% at a subject so its technique
 * names find room within the rim (the winner's round-3 fix).
 */
export function glassFill(level: number, v: { x0: number; x1: number; y0: number; y1: number }): number {
  const half = Math.min(v.x1 - v.x0, v.y1 - v.y0) / 2;
  if (half <= 0) return 1;
  const { rp } = glassFor(v);
  const want = (rp * (level >= 3 ? 0.72 : 0.93)) / half;
  return want / (USUAL_FILL[Math.max(0, Math.min(3, level))] ?? 0.9);
}
