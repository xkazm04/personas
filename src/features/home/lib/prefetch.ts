/**
 * Route-level prefetch helpers for the home screen.
 *
 * Each prefetcher is cached after first invocation so repeat calls are cheap.
 * Failures are swallowed — browser/webpack treats the chunk as still-absent
 * and will retry naturally on real navigation.
 */

type Prefetcher = () => Promise<unknown>;

function cache(fn: Prefetcher): Prefetcher {
  let pending: Promise<unknown> | null = null;
  return () => {
    if (!pending) pending = fn().catch(() => { pending = null; });
    return pending;
  };
}

// Home tabs
export const prefetchHomeReleases = cache(() => import('@/features/home/components/releases/HomeReleases'));
export const prefetchHomeLearning = cache(() => import('@/features/home/components/HomeLearning'));

// Top-level sidebar section targets (mirrors the lazy imports in PersonasPage).
const NAV_PREFETCHERS: Record<string, Prefetcher> = {
  overview: cache(() => import('@/features/overview/components/dashboard/OverviewPage')),
  personas: cache(() => import('@/features/agents/components/persona/PersonaOverviewPage')),
  events: cache(() => import('@/features/triggers/TriggersPage')),
  credentials: cache(() => import('@/features/vault/sub_credentials/manager/CredentialManager')),
  'design-reviews': cache(() => import('@/features/templates/components/DesignReviewsPage')),
  plugins: cache(() => import('@/features/plugins/PluginBrowsePage')),
  settings: cache(() => import('@/features/settings/components/SettingsPage')),
};

export function prefetchNavTarget(id: string): void {
  const fn = NAV_PREFETCHERS[id];
  if (fn) void fn();
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
