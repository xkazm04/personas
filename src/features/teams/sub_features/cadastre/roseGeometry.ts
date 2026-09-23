// The rose's geometry, ported from the winner (B/1's rating figure): wedges as
// wide as their weights and as long as their scores, and a radius SOLVED from
// the measured width of every label, so the figure is drawn at its real pixel
// size and no label is clipped at any box size.
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import { FEATURE_V1 } from '@/features/companions/curator/council/table/rubrics';

import type { Measure } from './cadastreLayout';

export interface RoseDim {
  dimension: string;
  weight: number;
  /** Null is not measured (or never judged): a hatched ghost petal, never 0. */
  score: number | null;
  floor: number | null;
  floorHit: boolean;
  /** No council has judged the feature: the rubric drawn as ghosts. */
  ghost: boolean;
}

/** The latest verdicts, or the rubric's five members as ghosts. */
export function roseDims(feature: BoardFeature): RoseDim[] {
  if (feature.verdicts.length > 0) {
    return feature.verdicts.map((v) => ({
      dimension: v.dimension,
      weight: v.weight,
      score: v.state === 'measured' ? v.score : null,
      floor: v.floor,
      floorHit: v.floorHit,
      ghost: false,
    }));
  }
  return Object.entries(FEATURE_V1.dimensions).map(([dimension, d]) => ({
    dimension, weight: d.weight, score: null, floor: null, floorHit: false, ghost: true,
  }));
}

export function wedge(cx: number, cy: number, r1: number, r2: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x1, y1] = p(r2, a0);
  const [x2, y2] = p(r2, a1);
  const [x3, y3] = p(r1, a1);
  const [x4, y4] = p(r1, a0);
  return `M${x1.toFixed(2)},${y1.toFixed(2)}A${r2},${r2} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}L${x3.toFixed(2)},${y3.toFixed(2)}A${r1},${r1} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)}Z`;
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x1, y1] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const [x2, y2] = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  return `M${x1.toFixed(2)},${y1.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

export interface RoseLabel { d: RoseDim; mid: number; w: number; name: string; value: string; weight: string }

/** Every label with its angle and measured width (name over value + weight). */
export function roseLabels(dims: RoseDim[], names: (dim: string) => string, value: (d: RoseDim) => string, pct: (w: number) => string, m: Measure): RoseLabel[] {
  let a = -Math.PI / 2;
  return dims.map((d) => {
    const span = d.weight * Math.PI * 2;
    const mid = a + span / 2;
    a += span;
    const name = names(d.dimension);
    const v = value(d);
    const weight = pct(d.weight);
    const w = Math.max(m(name, 700, 13), (d.score == null ? m(v, 500, 13) : m(v, 800, 16)) + m(`  ${weight}`, 500, 13)) + 4;
    return { d, mid, w, name, value: v, weight };
  });
}

/** The largest radius at which every label still fits inside W x H. */
export function roseRadius(labels: RoseLabel[], W: number, H: number, withEnvelope: boolean): number {
  const off = withEnvelope ? 46 : 18;
  const env = withEnvelope ? 36 : 0;
  let R = Math.min(W, H) / 2 - env - 6;
  for (const l of labels) {
    const c = Math.cos(l.mid);
    const s = Math.sin(l.mid);
    if (Math.abs(c) > 0.25) R = Math.min(R, (W / 2 - 6 - l.w) / Math.abs(c) - off);
    else R = Math.min(R, (W / 2 - 6 - l.w / 2) / Math.max(Math.abs(c), 0.05) - off);
    if (s < -0.3) R = Math.min(R, (H / 2 - 28) / -s - off);
    else if (s > 0.3) R = Math.min(R, (H / 2 - 40) / s - off);
  }
  return Math.max(70, Math.min(R, 250));
}

/** Where a scenario lands in the envelope the board already folded. */
export type EnvelopeFold = 'holds' | 'weak' | 'unmeasured' | 'out_of_scope' | 'proposed';

export function foldOf(feature: BoardFeature, slug: string): EnvelopeFold {
  const e = feature.envelope;
  if (!e) return 'unmeasured';
  if (e.holds.includes(slug)) return 'holds';
  if (e.weak.includes(slug)) return 'weak';
  if (e.outOfScope.includes(slug)) return 'out_of_scope';
  if (e.proposed.includes(slug)) return 'proposed';
  return 'unmeasured';
}
