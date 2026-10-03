/**
 * Route-level prefetch helpers for the home screen.
 *
 * Each prefetcher is cached after first invocation so repeat calls are cheap.
 * Failures are swallowed — browser/webpack treats the chunk as still-absent
 * and will retry naturally on real navigation.
 */
import { silentCatch } from '@/lib/silentCatch';
import { prefetchSection } from '@/features/shared/chrome/navPrefetch';
import { isHomeTabAvailable } from '@/features/shared/chrome/sidebar/sidebarData';
import type { HomeTab } from '@/lib/types/types';

type Prefetcher = () => Promise<unknown>;

function cache(fn: Prefetcher): Prefetcher {
  let pending: Promise<unknown> | null = null;
  return () => {
    if (!pending) {
      pending = fn().catch((err) => {
        silentCatch('home/prefetch:chunkPrefetch')(err);
        pending = null;
      });
    }
    return pending;
  };
}

// Home tabs. One entry per row in `homeItems` - all five are lazy chunks since 2026-10-03, so
// all five want warming; the map's key is the tab id so the caller can skip the one it is on.
const HOME_TAB_CHUNKS: Partial<Record<HomeTab, Prefetcher>> = {
  welcome: cache(() => import('@/features/home/sub_welcome/HomeWelcome')),
  cockpit: cache(() => import('@/features/home/sub_cockpit/CockpitPanel')),
  roadmap: cache(() => import('@/features/home/sub_releases/HomeReleases')),
  learning: cache(() => import('@/features/home/sub_learning/HomeLearning')),
  'system-check': cache(() => import('@/features/overview/components/health/SystemHealthPanel')),
};

/**
 * Warm ONE home tab's chunk - the L2 rail's hover/focus intent.
 *
 * Takes a plain `string` and TESTS membership rather than asserting the caller's id into
 * `HomeTab` (census rule `unchecked-destination-id-assertion`, golden path
 * `navigation-destination.md`): the rail hands out whatever id its row carries, and an id that
 * is not a home tab must warm nothing, not index this map on a lie.
 */
export function prefetchHomeTab(id: string): void {
  for (const [tab, load] of Object.entries(HOME_TAB_CHUNKS)) {
    if (tab === id) {
      void load?.();
      return;
    }
  }
}

// Top-level section targets: delegated to the shell's shared, deduped
// section-chunk map (`shared/chrome/navPrefetch.ts`), the same map the main
// rail's hover prefetch and the content router use. A card hover and a rail
// hover on the same section cost one import between them.
export function prefetchNavTarget(id: string): void {
  void prefetchSection(id);
}

type IdleCb = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
type IdleScheduler = (cb: IdleCb, opts?: { timeout?: number }) => number;

function schedule(cb: () => void): () => void {
  const g = globalThis as unknown as { requestIdleCallback?: IdleScheduler; cancelIdleCallback?: (h: number) => void };
  if (typeof g.requestIdleCallback === 'function') {
    const handle = g.requestIdleCallback(() => cb(), { timeout: 2000 });
    return () => g.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(cb, 300);
  return () => clearTimeout(handle);
}

/**
 * Kick off idle-time prefetch of every home tab EXCEPT the one already on screen.
 *
 * Called from `HomePage` rather than from a tab's own mount: it used to fire from the Welcome
 * surface, which is `devOnly`, so a production landing (Cockpit) warmed nothing and every tab
 * switch paid a cold chunk fetch. A tab a build cannot reach is skipped rather than fetched -
 * `isHomeTabAvailable` is the same predicate `HomePage` routes on.
 */
export function schedulePrefetchOtherHomeTabs(active?: HomeTab): () => void {
  return schedule(() => {
    for (const [tab, load] of Object.entries(HOME_TAB_CHUNKS) as Array<[HomeTab, Prefetcher]>) {
      if (tab === active || !isHomeTabAvailable(tab)) continue;
      void load();
    }
  });
}
