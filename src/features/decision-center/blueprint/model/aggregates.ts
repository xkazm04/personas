// Aggregates over places (wing, room, bay) that the plan prints: stage counts and per-lens health counts.
// bp's own (src/lib/model/aggregates.ts) are time-aware and cached; the live drawing is always "now" and the
// layout is small, so these are plain folds. Words are NOT here: the engine and the panels take them from t.
import type { Feature, Health, Stage } from '../standard/load';

export interface Counts { n: number; live: number; flagged: number; build: number; paper: number; dep: number; none: number }
export type HealthCounts = Record<Health, number>;

/** bp's grouping: built = live; partly open = flagged; being built = in-dev + in-review; on paper = specified + idea. */
export function counts(fs: readonly Feature[]): Counts {
  const c: Counts = { n: fs.length, live: 0, flagged: 0, build: 0, paper: 0, dep: 0, none: 0 };
  for (const f of fs) {
    const s = f.stage as Stage | null;
    if (s === 'live') c.live++;
    else if (s === 'flagged') c.flagged++;
    else if (s === 'in-dev' || s === 'in-review') c.build++;
    else if (s === 'specified' || s === 'idea') c.paper++;
    else if (s === 'deprecated') c.dep++;
    else c.none++;
  }
  return c;
}

/** Health counts under a lens id, or General when `lens` is null. */
export function healthOf(fs: readonly Feature[], lens: string | null): HealthCounts {
  const h: HealthCounts = { good: 0, watch: 0, bad: 0, na: 0, unmeasured: 0 };
  for (const f of fs) h[lens ? f.lens[lens]?.h ?? 'unmeasured' : f.health]++;
  return h;
}

export const STAGE_ORDER: readonly Stage[] = ['idea', 'specified', 'in-dev', 'in-review', 'flagged', 'live', 'deprecated'];

export const dayOf = (iso: string) => iso.slice(0, 10);
