import type { DevInstance, DevOutcome } from '../../engine/devAdapter';
import type { SpineModel } from '../../engine/spine';
import { pct } from '../../labels';
import type { Departures } from './dialFate';

/** One tick is 1/120 of the sessions. */
export const TICKS = 120;

/** What a tick can be: the four ways a session leaves a ring, then the hollow rest (never got there). */
export type TickType = 0 | 1 | 2 | 3 | 4;

export interface Ring {
  q: number;
  /** went on, ended clean, errored, interrupted */
  counts: [number, number, number, number];
  /** the same, in ticks */
  t: [number, number, number, number];
  lit: number;
  /** ticks of the amber hairline: how many stumbled */
  stum: number;
  /** the whole mode's reach share, for the white mark behind a picked repository */
  cohort: number;
}

/** Largest-remainder rounding of counts into `T` ticks; a non-zero group keeps at least one. */
export function alloc(counts: number[], total: number, T: number): number[] {
  const tot = Math.max(1, total);
  const sum = counts.reduce((a, b) => a + b, 0);
  const target = sum > 0 ? Math.max(1, Math.round((sum / tot) * T)) : 0;
  const raw = counts.map((c) => (c / tot) * T);
  const fl = raw.map(Math.floor);
  const left = target - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((_, i) => i).sort((a, b) => raw[b]! - fl[b]! - (raw[a]! - fl[a]!));
  for (let i = 0; i < left; i++) fl[order[i % order.length]!]!++;
  counts.forEach((c, i) => {
    if (c > 0 && fl[i] === 0) {
      let m = 0;
      fl.forEach((v, j) => { if (v > fl[m]!) m = j; });
      if (fl[m]! > 1) { fl[m]!--; fl[i] = 1; }
    }
  });
  return fl;
}

export function buildRings(model: SpineModel, base: SpineModel, dep: Departures): Ring[] {
  const N = Math.max(1, model.n);
  const last = model.stations.length - 1;
  return model.stations.map((s, q) => {
    const d = dep[q]!;
    const cont = q < last ? model.stations[q + 1]!.reached : d.landed;
    const counts: Ring['counts'] = [cont, d.quiet + (q < last ? d.landed : 0), d.errored, d.interrupted];
    const t = alloc(counts, N, TICKS) as Ring['t'];
    return {
      q,
      counts,
      t,
      lit: t[0] + t[1] + t[2] + t[3],
      stum: Math.round((s.friction / N) * TICKS),
      cohort: base.stations[q]!.reached / Math.max(1, base.n),
    };
  });
}

export interface RepoArc {
  name: string;
  n: number;
  landed: number;
  quiet: number;
  interrupted: number;
  errored: number;
  /** degrees clockwise from twelve o'clock */
  a0: number;
  a1: number;
  span: number;
}

const GAP = 1.6;
const MIN_SPAN = 1.4;

/** The bezel: every repository of the mode as an arc, in proportion, stacked by outcome. */
export function buildArcs(cohort: DevInstance[]): RepoArc[] {
  const by = new Map<string, RepoArc>();
  for (const x of cohort) {
    const r = by.get(x.project) ?? { name: x.project, n: 0, landed: 0, quiet: 0, interrupted: 0, errored: 0, a0: 0, a1: 0, span: 0 };
    r.n++;
    // Invariant: `devInstances` assigns every session one of the four DevOutcome values.
    r[x.outcome as DevOutcome]++;
    by.set(x.project, r);
  }
  const list = [...by.values()].sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
  const avail = 360 - GAP * list.length;
  const spans = list.map((r) => Math.max(MIN_SPAN, (r.n / Math.max(1, cohort.length)) * avail));
  const ss = spans.reduce((a, b) => a + b, 0);
  let a0 = 0;
  list.forEach((r, i) => {
    const sp = (spans[i]! * avail) / ss;
    r.a0 = a0;
    r.a1 = a0 + sp;
    r.span = sp;
    a0 += sp + GAP;
  });
  return list;
}

export interface Figure {
  index: number;
  keys: string[];
  n: number;
  reached: number;
  reachPct: number;
  skipped: number;
  exits: number;
  exitPct: number | null;
  stumbled: number;
  stumblePct: number | null;
  medWait: number;
  p75Wait: number;
  /** 1-based rank among the three worst stations, or 0 */
  rank: number;
  /** the same station over the whole mode, when a repository is picked */
  vs: { n: number; reachPct: number; exitPct: number | null; stumblePct: number | null } | null;
}

/** Every figure a station needs, plain: reach, failing ends, stumbles, waits, and the whole-mode twin. */
export function buildFigures(model: SpineModel, base: SpineModel, repoPicked: boolean): Figure[] {
  const rankOf = new Map<number, number>();
  model.worst.slice(0, 3).forEach((q, i) => rankOf.set(q, i + 1));
  return model.stations.map((s, q) => {
    const b = base.stations[q]!;
    return {
      index: q,
      keys: s.keys,
      n: model.n,
      reached: s.reached,
      reachPct: pct(s.reached, model.n),
      skipped: s.skipped,
      exits: s.exits,
      exitPct: s.reached ? pct(s.exits, s.reached) : null,
      stumbled: s.friction,
      stumblePct: s.reached ? pct(s.friction, s.reached) : null,
      medWait: s.medWait,
      p75Wait: s.p75Wait,
      rank: rankOf.get(q) ?? 0,
      vs: repoPicked
        ? {
            n: base.n,
            reachPct: pct(b.reached, base.n),
            exitPct: b.reached ? pct(b.exits, b.reached) : null,
            stumblePct: b.reached ? pct(b.friction, b.reached) : null,
          }
        : null,
    };
  });
}

/** Which kind of tick sits at index i of a ring. */
export function tickType(r: Ring, i: number): TickType {
  let k = i;
  for (let g = 0; g < 4; g++) {
    if (k < r.t[g as 0 | 1 | 2 | 3]) return g as TickType;
    k -= r.t[g as 0 | 1 | 2 | 3];
  }
  return 4;
}
