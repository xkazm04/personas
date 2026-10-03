import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import type { HomeTab } from '@/lib/types/types';
import { lazyRetry } from '@/lib/lazyRetry';
import { useMorningBriefing } from '@/features/home/sub_cockpit/briefing/useMorningBriefing';
import { useLastSeenHeartbeat } from '@/features/home/sub_welcome/lib/sinceLeftBriefing';
import { schedulePrefetchOtherHomeTabs } from '@/features/home/lib/prefetch';
import { DEFAULT_HOME_TAB, isHomeTabAvailable } from '@/features/shared/chrome/sidebar/sidebarData';

// EVERY tab is a chunk of its own, including the three dev-only ones. Welcome and System Check
// were static imports until 2026-10-03, which put two whole surfaces -- the second of them the
// health board, its five prototypes, the installer wiring and the configuration popups -- into
// the chunk this page is, in every build. Three of the five rows here carry `devOnly` in
// `homeItems`, so a production build can never reach them, and `import.meta.env.DEV` folds to
// `false` at build time: their only reference is inside a dead branch, and the chunk goes with it.
// (`docs/design/overview-loading.md` is about which FETCH a region waits on; this is the same
// question asked of CODE -- the first screen must not be gated on the last section's module.)
// The two NEW boundaries take `lazyRetry`, not `lazy`: it is the documented form
// (`docs/concepts/golden-paths/lazy-route-chunk.md`, census rule `raw-react-lazy`) and survives a
// failed chunk fetch instead of caching the rejection forever. The three below are the pre-existing
// raw ones; converting them is a baseline move and belongs in its own commit.
const HomeWelcome = lazyRetry(() => import('@/features/home/sub_welcome/HomeWelcome'));
const HomeReleases = lazy(() => import('@/features/home/sub_releases/HomeReleases'));
const HomeLearning = lazy(() => import('@/features/home/sub_learning/HomeLearning'));
const Cockpit = lazy(() => import('@/features/home/sub_cockpit/CockpitPanel'));
const SystemCheck = lazyRetry(() =>
  import('@/features/overview/components/health/SystemHealthPanel').then((m) => ({ default: m.SystemHealthPanel })),
);

const PANE_CLASS = 'animate-fade-slide-in flex-1 min-h-0 flex flex-col w-full overflow-hidden';

/**
 * Keep-alive tab pane. Renders its children mounted while it's a visited tab,
 * hiding (not unmounting) the inactive ones with `display:none`. This replaces
 * the old `key={homeTab}` remount, which threw away and re-ran each tab's mount
 * work on every switch — most painfully the Welcome surface (nav-status fetches,
 * fleet metrics, deferred-node commit). A hidden pane keeps its React tree and
 * DOM, so returning to it is instant with no refetch.
 */
function KeepAlivePane({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={active ? PANE_CLASS : 'hidden'} aria-hidden={!active}>{children}</div>;
}

export default function HomePage() {
  const homeTab = useSystemStore((s) => s.homeTab);
  const isDev = import.meta.env.DEV;

  // Morning Director: once per app session, compose the session-open
  // briefing from the since-left delta (delta-gated — no LLM call when
  // nothing happened) and surface it as a Cockpit overlay.
  useMorningBriefing();

  // Stamp the last-seen anchor the briefing above (and the resume signal) read
  // on the NEXT launch. It has to live here, not on the Welcome surface: that
  // surface is DEV-only, so production never wrote an anchor and every session
  // looked like a first run. Declared after `useMorningBriefing` only for
  // readability - that hook freezes its anchor in a render-phase initializer,
  // before any effect here can advance it.
  useLastSeenHeartbeat();

  // The effective active tab. Welcome / What's New / System Check are DEV-only
  // (`homeItems[].devOnly` — the same flag that hides them from the L2 sidebar);
  // outside DEV — and for any unknown value from stale persisted state — the tab
  // falls back to `DEFAULT_HOME_TAB`, which is the first row a production build
  // actually shows. Without this a persisted `homeTab: 'welcome'` would paint a
  // surface with no sidebar row to match it.
  const activeTab: HomeTab = isHomeTabAvailable(homeTab) ? homeTab : DEFAULT_HOME_TAB;

  // Warm the OTHER tabs' chunks in an idle slot, so the one cost of splitting them -- a tab
  // switch that has to fetch a module -- is paid before anyone switches. This used to fire from
  // the Welcome surface's own mount, which is a dev-only tab: a production landing (Cockpit)
  // warmed nothing. `prefetch.ts` dedupes per chunk and swallows failures.
  useEffect(() => schedulePrefetchOtherHomeTabs(activeTab), [activeTab]);

  // Track which tabs have EVER been active. Only visited tabs are mounted, so
  // the first paint mounts Welcome alone (the default) — cockpit/roadmap/learning
  // stay off the tree until the user opens them, preserving the lazy-load +
  // WebView2 node-commit discipline. Once visited, a tab stays mounted (hidden)
  // for the session.
  const visitedRef = useRef<Set<HomeTab>>(new Set());
  visitedRef.current.add(activeTab);
  const visited = visitedRef.current;

  // Suspense fallback for a lazy Home tab chunk (docs/design/overview-loading.md §D).
  // Invisible for the first 150ms (`animate-fade-in` + `fill-mode: both`) so a
  // warm/cached chunk resolves before a single pixel of it paints — no spinner
  // flash on tab switches. The tabs (Cockpit/Roadmap/Learning) don't share any
  // body geometry, so the fallback ghosts nothing beyond the pane's own flex
  // shell — faking body content here would just produce a different blink.
  const fallback = (
    <div
      aria-hidden="true"
      className="flex-1 min-h-0 flex flex-col w-full animate-fade-in"
      style={{ animationDelay: '150ms' }}
    />
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {isDev && visited.has('welcome') && (
        <KeepAlivePane active={activeTab === 'welcome'}>
          <Suspense fallback={fallback}><HomeWelcome /></Suspense>
        </KeepAlivePane>
      )}
      {visited.has('cockpit') && (
        <KeepAlivePane active={activeTab === 'cockpit'}>
          <Suspense fallback={fallback}><Cockpit /></Suspense>
        </KeepAlivePane>
      )}
      {isDev && visited.has('roadmap') && (
        <KeepAlivePane active={activeTab === 'roadmap'}>
          <Suspense fallback={fallback}><HomeReleases /></Suspense>
        </KeepAlivePane>
      )}
      {visited.has('learning') && (
        <KeepAlivePane active={activeTab === 'learning'}>
          <Suspense fallback={fallback}><HomeLearning /></Suspense>
        </KeepAlivePane>
      )}
      {isDev && visited.has('system-check') && (
        <KeepAlivePane active={activeTab === 'system-check'}>
          <Suspense fallback={fallback}><SystemCheck /></Suspense>
        </KeepAlivePane>
      )}
    </div>
  );
}
