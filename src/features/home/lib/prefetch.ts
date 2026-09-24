/**
 * Route-level prefetch helpers for the home screen.
 *
 * Each prefetcher is cached after first invocation so repeat calls are cheap.
 * Failures are swallowed — browser/webpack treats the chunk as still-absent
 * and will retry naturally on real navigation.
 */
import { silentCatch } from '@/lib/silentCatch';
import { prefetchSection } from '@/features/shared/chrome/navPrefetch';

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

// Home tabs
export const prefetchHomeReleases = cache(() => import('@/features/home/sub_releases/HomeReleases'));
export const prefetchHomeLearning = cache(() => import('@/features/home/sub_learning/HomeLearning'));

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

/** Kick off idle-time prefetch of the other home tabs once Welcome has mounted. */
export function schedulePrefetchOtherHomeTabs(): () => void {
  return schedule(() => {
    void prefetchHomeReleases();
    void prefetchHomeLearning();
  });
}
