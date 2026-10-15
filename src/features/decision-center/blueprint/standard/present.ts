// PORTED from bp src/lib/standard/present.ts @ fbef867 (spark one-control, WP4a). Pure: no DOM, no IPC.
// EDIT (port): bp's lensLine (a lens line's length), hotHealth (a field's hot mark) and HEALTH_TEXT (English words per health) are
// dropped: this sheet draws none of them, and its words come from t.decisionCenter.blueprint.
// EDIT (port): relative imports lose their .ts suffix. Re-sync by copying again; never hand-drift it.
// Reader helpers that the spec defines but the evaluator does not need: the General health of a
// feature (spec 8.4, last paragraph), how many evidence fields a reader shows (8.6, `evidence`) and
// the measured length of a lens line (8.6, "The lens line"). Pure and dependency-free like health.ts,
// so Node's type stripping and a Rust port can follow it.
import type { ComputedHealth, Density, Health, Stage } from './types';

const SCORE: Record<ComputedHealth, number> = { good: 0, watch: 1, bad: 2 };

/**
 * A feature's health in a General view: the worst of its lenses' measured healths (bad over watch over
 * good), over enabled lenses only. `na` and `unmeasured` do not count; none measured: `unmeasured`.
 */
export function generalHealth(hs: Iterable<Health>): Health {
  let worst: ComputedHealth | null = null;
  for (const h of hs) {
    if (h !== 'good' && h !== 'watch' && h !== 'bad') continue;
    if (worst === null || SCORE[h] > SCORE[worst]) worst = h;
  }
  return worst ?? 'unmeasured';
}

/**
 * The one density table: how many evidence fields / metric rows a reader of each density sees on each surface
 * (simple reads light, dense is terminal-dense; Infinity = all). Every surface reads this, none keeps its own.
 */
export const DENSITY_COUNT: Readonly<Record<'canvas' | 'drawer' | 'page', Readonly<Record<Density, number>>>> = {
  canvas: { simple: 2, standard: 3, dense: 4 },
  drawer: { simple: 3, standard: 5, dense: Infinity },
  page: { simple: 2, standard: 4, dense: Infinity },
};
/** The canvas column (tile evidence, lens evidence). */
export const EVIDENCE_BY_DENSITY = DENSITY_COUNT.canvas;

/** The numeric field types: the ones with bounds, a metric, a measured line or a rollup weight. */
export const NUMERIC = new Set<string>(['number', 'integer', 'percent', 'money']);

/** The reason a lens is unwell: the override's `why` when one holds the health, else the deciding rule's filled `why` (null when none decided). */
export function reasonOf(fl: { ov: { why: string } | null; why: string | null }): string | null {
  return fl.ov ? fl.ov.why : fl.why;
}

/** The stage a revision list (oldest first) puts a feature in on `d`: the last revision at or before it; null before the first. */
export function stageOn(revs: readonly { stage: Stage; date: string }[], d: string): Stage | null {
  let s: Stage | null = null;
  for (const h of revs) { if (h.date > d) break; s = h.stage; }
  return s;
}

/**
 * The stage a feature had on date `d`, replayed from the events log (spec 10): the `to` of its last stage (or
 * feature-added) event at or before `d`. null = not yet on the drawing, or unknown "now".
 */
export function stageAt(f: { stage: Stage | null; revs: readonly { stage: Stage; date: string }[] }, d: string, asOf: string): Stage | null {
  return d >= asOf ? f.stage : stageOn(f.revs, d);
}
