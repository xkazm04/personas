// The triage side of the work (WP4b): which built items the compare panel walks and in what order, and an item's
// evidence as compare.ts reads it. Pure over the store's rows; the store's statuses are never re-derived here.
import { compareOf, type Comparison } from '@/lib/lensScan/compare';
import type { ScanSnapshot } from '@/lib/lensScan/wire';
import type { Plan } from './plan';
import { STATUS } from './states';
import type { Work, WorkItem } from './work';

/** A built item of a pack (the compare panel shows it): it has a pack and the state table says it was built. */
export const isBuilt = (p: WorkItem): boolean => !!p.pack && STATUS[p.status].built;

/**
 * Every built item in the order bp's ledger walks them (compare panel J/K): packs oldest first, as the snapshot holds
 * them, and each pack's items as built (created_at, then id). `lens` keeps one lens's items ('general' keeps all).
 */
export function packOrder(work: Work, lens = 'general'): WorkItem[] {
  const out: WorkItem[] = [];
  const byCreated = (a: WorkItem, b: WorkItem) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const k of work.packs) {
    if (lens !== 'general' && k.lens !== lens) continue;
    out.push(...work.items.filter((p) => p.pack === k.id && isBuilt(p)).sort(byCreated));
  }
  return out;
}

/** The item's place in its own pack: 1-based, and how many built items the pack holds. */
export function placeInPack(work: Work, p: WorkItem): { n: number; of: number } | null {
  if (!p.pack) return null;
  const mates = packOrder(work).filter((x) => x.pack === p.pack);
  const i = mates.findIndex((x) => x.id === p.id);
  return i < 0 ? null : { n: i + 1, of: mates.length };
}

/** compare.ts compareOf over the store's rows, with the map's lenses for the metric directions. */
export const comparisonOf = (scan: ScanSnapshot, plan: Plan, id: string): Comparison | null => compareOf(scan, id, plan.lenses);
