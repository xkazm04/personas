// The ONE module that computes the sheet's headline figures. The header summary, the Plan panel and its overview, the
// queue's product line, the Here block and the ledger switch all read these functions, so one label never shows two
// numbers. Definitions, once:
//   live       = stage live, a flagged (partly open) feature counted inside it. The word is "live" everywhere.
//   in trouble = bad. A feature to watch is its OWN figure ("watch"), never folded into trouble.
//   waiting    = proposed work on a feature that is on the plan; `offPlan` = proposed work whose feature is not.
import type { Feature } from '../standard/load';
import { counts, healthOf } from './aggregates';
import type { Work, WorkItem } from './work';

export interface Figures { n: number; live: number; build: number; paper: number; dep: number; bad: number; watch: number }

/** A set of features' figures; `lens` null = General health, a lens id = that lens's health. */
export function figures(feats: readonly Feature[], lens: string | null = null): Figures {
  const c = counts(feats), h = healthOf(feats, lens);
  return { n: c.n, live: c.live + c.flagged, build: c.build, paper: c.paper, dep: c.dep, bad: h.bad, watch: h.watch };
}

/** One lens's trouble over a set of features; `measured` is false when no feature has a reading under it. */
export function lensFigures(feats: readonly Feature[], lens: string): { bad: number; watch: number; measured: boolean } {
  const h = healthOf(feats, lens);
  return { bad: h.bad, watch: h.watch, measured: feats.length - h.unmeasured > 0 };
}

const isWaiting = (p: { status: string }) => p.status === 'proposed';

/** Waiting (proposed) items in a list of work items. */
export const waitingOf = (items: readonly WorkItem[]): number => items.reduce((n, p) => n + (isWaiting(p) ? 1 : 0), 0);

/** Approved, not yet built items in a list of work items. */
export const approvedOf = (items: readonly WorkItem[]): number => items.reduce((n, p) => n + (p.status === 'approved' ? 1 : 0), 0);

/** Proposals waiting whose feature is not on the plan: they are in the ledger and nowhere on the drawing. */
export const offPlanWaiting = (work: Work): number => (work.offPlan ?? []).reduce((n, p) => n + (isWaiting(p) ? 1 : 0), 0);

/** Every waiting finding the ledger lists: the plan's and the off-plan ones. */
export const openFindings = (work: Work): number => waitingOf(work.items) + offPlanWaiting(work);
