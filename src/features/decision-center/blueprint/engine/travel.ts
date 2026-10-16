// Time travel and the recent window, as pure functions (PORTED from bp src/lib/model/aggregates.ts stageAt / deltaWin /
// countsOf and Engine.isNow): the drawing at a date replays every feature's stage from the events log (the map's
// revision list); a feature not yet added on that date has no stage and is drawn as "not yet drawn". The recent window
// (the rail's View, `viewDays`) decides which features fly the delta triangle: a stage change within that many days
// before the date the plan is viewed at. No DOM, no engine: the engine and its tests both call these.
import type { Feature, Stage } from '../standard/load';
import { stageAt } from '../standard/present';
import type { Counts } from '../model/aggregates';
import { dnum } from '../model/layout';

/** The stage a feature is drawn in: its stage now, or (travelled to `at`) the stage the events log gives it on that day. */
export function stageOfAt(f: Pick<Feature, 'stage' | 'revs'>, at: string | null, asOf: string): Stage | null {
  return at === null || at >= asOf ? f.stage : stageAt(f, at, asOf);
}

/** bp deltaWin: the revision that moved the feature's stage within `days` days up to `end` (inclusive), or null. */
export function deltaWin(f: Pick<Feature, 'revs'>, end: string, days: number): { stage: Stage; date: string } | null {
  const t = dnum(end), from = t - days;
  for (let i = f.revs.length - 1; i >= 0; i--) { const r = f.revs[i]!, d = dnum(r.date); if (d > from && d <= t) return r; }
  return null;
}

/** bp countsOf at a date: built, partly open, being built, on paper, demolish, and not yet drawn (no stage then). */
export function countsAt(fs: readonly Feature[], stageOf: (f: Feature) => Stage | null): Counts {
  const c: Counts = { n: fs.length, live: 0, flagged: 0, build: 0, paper: 0, dep: 0, none: 0 };
  for (const f of fs) {
    const s = stageOf(f);
    if (s === 'live') c.live++;
    else if (s === 'flagged') c.flagged++;
    else if (s === 'in-dev' || s === 'in-review') c.build++;
    else if (s === 'specified' || s === 'idea') c.paper++;
    else if (s === 'deprecated') c.dep++;
    else c.none++;
  }
  return c;
}

/** The revision number of a date: how many weeks of the history lie at or before it (1 at the least, bp revAt). */
export function revAt(weeks: readonly string[], d: string): number {
  let r = 0;
  weeks.forEach((w, i) => { if (w <= d) r = i + 1; });
  return r || 1;
}
