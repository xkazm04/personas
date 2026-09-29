// Ship-milestone summaries for the canvas: ONE batched wall-summary IPC for
// every real project, reduced to the banner's next/shipped/late shape via the
// same roadmap builder the passport wall uses (the two surfaces must agree on
// "next"). Module-level with a short cache so a prefetch (prefetchMastermind)
// can fill it before the page mounts and the page's own load reuses it.
import { projectWallSummary } from '@/api/devTools/milestones';
import { createTtlValueCache } from '@/lib/async/createTtlValueCache';
import { buildCoverRoadmap } from '@/features/teams/sub_factory/passport/CoverRoadmap';

import type { IslandShip } from './types';

const shipCache = createTtlValueCache<Map<string, IslandShip>>(60_000);
const inflight = new Map<string, Promise<Map<string, IslandShip>>>();

export const shipKey = (ids: readonly string[]) => [...ids].sort().join('|');

/** The cached summaries for exactly this project set, if fresh. */
export function cachedShipSummaries(ids: readonly string[]): Map<string, IslandShip> | undefined {
  return shipCache.get(shipKey(ids));
}

/** Load (or join / reuse) the summaries for this project set. Rejects on IPC
 *  failure; the caller decides how to degrade. */
export function loadShipSummaries(ids: readonly string[]): Promise<Map<string, IslandShip>> {
  const key = shipKey(ids);
  const hit = shipCache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const p = projectWallSummary([...ids])
    .then((rows) => {
      const m = new Map<string, IslandShip>();
      for (const r of rows) {
        const vm = buildCoverRoadmap(r.milestones);
        if (vm.steps.length === 0) continue;
        m.set(r.projectId, {
          next: vm.next?.name ?? null,
          nextStatus: vm.next?.status === 'active' ? 'active' : vm.next ? 'planned' : null,
          shipped: vm.shipped,
          total: vm.steps.length,
          targetDate: vm.next?.targetDate ?? null,
          forecastDate: vm.forecast?.date ?? null,
          late: vm.forecast?.late ?? false,
          // Plan order with the cut one first: the same rule `buildCoverRoadmap`
          // uses to pick `next`, extended to the two behind it. Capped at three
          // because this renders inside an island: a fourth row costs more
          // vertical space than it returns at any zoom a human reads at.
          upcoming: vm.steps
            .filter((st) => st.status !== 'shipped')
            .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1))
            .slice(0, 3)
            .map((st) => ({ name: st.name, status: st.status === 'active' ? 'active' as const : 'planned' as const })),
        });
      }
      shipCache.set(key, m);
      return m;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}
