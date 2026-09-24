// THE RIVERBED - a river drawn inside its bed.
//
// The bed's width is every KPI DECLARED at this altitude. The water is the
// KPIs actually READ that week, stacked by verdict and mirrored around a
// centreline. That one decision is why this surface cannot flatter itself: a
// portfolio that stops measuring DRIES UP inside a bed that stays the same
// width, where the old stacked-area chart merely drew a thinner ribbon that
// still looked green.
//
// Two honesty rules the geometry enforces rather than annotates:
//   * A week with no reading is a GAP - a tick on the axis, never a zero, and
//     the banks are never interpolated across it.
//   * Water that was read but cannot be judged is SILT: pale, on the banks,
//     never counted as health.
//
// The weekly counts come from `weeklyStateSeries`, which filters to production
// observations that were actually measured, so a simulated row can never
// become water.
import type { WeeklyState } from '../../kpiSample';

export interface BedPoint {
  /** Monday 00:00 of the week, epoch ms. */
  week: number;
  /** KPIs read that week. 0 = a dry week, which is a gap, not a zero. */
  read: number;
  met: number;
  onTrack: number;
  offTrack: number;
  /** Read, no verdict possible - drawn as silt, never as a state. */
  silt: number;
  partial: boolean;
}

export interface Riverbed {
  /** The declared claim: the bed's width at every week. */
  declared: number;
  points: BedPoint[];
  /** Weeks in this window that carried no reading at all. */
  dryWeeks: number;
  /** The fullest CLOSED week - the honest peak, ignoring the open one. */
  peak: BedPoint | null;
  /** Read in the newest closed-or-open week. */
  latest: BedPoint | null;
}

export function toRiverbed(states: WeeklyState[], declared: number): Riverbed {
  const points: BedPoint[] = states.map((s) => ({
    week: s.week,
    read: s.measured,
    met: s.met,
    onTrack: s.onTrack,
    offTrack: s.offTrack,
    silt: Math.max(0, s.measured - (s.met + s.onTrack + s.offTrack)),
    partial: s.partial,
  }));
  const closed = points.filter((p) => !p.partial);
  const peak = closed.reduce<BedPoint | null>((best, p) => (best == null || p.read > best.read ? p : best), null);
  return {
    declared,
    points,
    dryWeeks: points.filter((p) => p.read === 0).length,
    peak: peak && peak.read > 0 ? peak : null,
    latest: points.length > 0 ? points[points.length - 1]! : null,
  };
}

/**
 * Half-width of the water at one week, in the bed's own units.
 *
 * A SQUARE ROOT, deliberately: this estate spans 9-KPI projects and 721-KPI
 * ones, and a linear width makes every small river invisible beside the large
 * one. The scale is therefore a COMPARISON, not a quantity to read off, and
 * the surface has to say so in the legend - which is the trade the contest's
 * judge named and the design accepted.
 */
export function waterHalfWidth(read: number, declared: number): number {
  if (read <= 0 || declared <= 0) return 0;
  return Math.sqrt(Math.min(1, read / declared)) / 2;
}

/** Runs of consecutive wet weeks. A dry week BREAKS the run rather than
 *  joining it, so the path is never drawn across a gap. */
export function wetRuns(points: BedPoint[]): BedPoint[][] {
  const runs: BedPoint[][] = [];
  let run: BedPoint[] = [];
  for (const p of points) {
    if (p.read > 0) {
      run.push(p);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

export type FlowKind =
  /** Nothing has EVER been read here, in this window or before it. */
  | 'never'
  /** Read at some point, but not once inside this window. A river that ran
   *  before the window opened is not a river that never ran, and saying so
   *  would call a fully-measured project unmeasured. */
  | 'before-window'
  | 'first-water'
  | 'narrowing'
  | 'widening'
  | 'steady'
  | 'quiet';

export interface Flow {
  kind: FlowKind;
  /** Weeks since the first reading in the window, for `first-water`. */
  weeksAgo: number;
  from: number;
  to: number;
  read: number;
  declared: number;
}

/**
 * What this river has been doing, as a fact rather than a shape: the sentence
 * under every tributary. A reader should never have to infer "nobody has
 * looked here since August" from a gradient.
 *
 * `everRead` is how many KPIs in this scope have a reading of ANY age, and it
 * is what separates `never` from `before-window`. Without it a project that is
 * 27 of 27 measured reads as "never had a reading" the moment its readings are
 * older than the window, which is the exact lie this surface exists to stop.
 */
export function describeFlow(bed: Riverbed, everRead = 0): Flow {
  const { points, declared } = bed;
  const wet = points.filter((p) => p.read > 0);
  const base: Flow = { kind: 'never', weeksAgo: 0, from: 0, to: 0, read: 0, declared };
  if (wet.length === 0) return everRead > 0 ? { ...base, kind: 'before-window', to: everRead } : base;

  const latest = points[points.length - 1]!;
  const firstWetIndex = points.findIndex((p) => p.read > 0);
  const weeksAgo = points.length - 1 - firstWetIndex;

  if (latest.read === 0) {
    const last = wet[wet.length - 1]!;
    return { ...base, kind: 'quiet', to: last.read, read: 0, weeksAgo: points.length - 1 - points.indexOf(last) };
  }
  // A river that only started in this window is described by its arrival, not
  // by a trend computed over weeks when the bed was empty.
  if (weeksAgo <= 2 && firstWetIndex > 0) {
    return { ...base, kind: 'first-water', weeksAgo, to: latest.read, read: latest.read };
  }
  const previous = wet.length >= 2 ? wet[wet.length - 2]! : null;
  if (!previous || previous.read === latest.read) {
    return { ...base, kind: 'steady', from: latest.read, to: latest.read, read: latest.read };
  }
  return {
    ...base,
    kind: latest.read < previous.read ? 'narrowing' : 'widening',
    from: previous.read,
    to: latest.read,
    read: latest.read,
    weeksAgo: 1,
  };
}
