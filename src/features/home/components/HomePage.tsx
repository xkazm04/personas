import { lazy, Suspense, useRef, type ReactNode } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import type { HomeTab } from '@/lib/types/types';
import { SystemHealthPanel } from '@/features/overview/components/health/SystemHealthPanel';
import HomeWelcome from '@/features/home/sub_welcome/HomeWelcome';
import { useMorningBriefing } from '@/features/home/sub_cockpit/briefing/useMorningBriefing';
import { DEFAULT_HOME_TAB, isHomeTabAvailable } from '@/features/shared/chrome/sidebar/sidebarData';

const HomeReleases = lazy(() => import('@/features/home/sub_releases/HomeReleases'));
const HomeLearning = lazy(() => import('@/features/home/sub_learning/HomeLearning'));
const Cockpit = lazy(() => import('@/features/home/sub_cockpit/CockpitPanel'));

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

  // The effective active tab. Welcome / What's New / System Check are DEV-only
  // (`homeItems[].devOnly` — the same flag that hides them from the L2 sidebar);
  // outside DEV — and for any unknown value from stale persisted state — the tab
  // falls back to `DEFAULT_HOME_TAB`, which is the first row a production build
  // actually shows. Without this a persisted `homeTab: 'welcome'` would paint a
  // surface with no sidebar row to match it.
  const activeTab: HomeTab = isHomeTabAvailable(homeTab) ? homeTab : DEFAULT_HOME_TAB;

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
          <HomeWelcome />
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
          <SystemHealthPanel />
        </KeepAlivePane>
      )}
    </div>
  );
}
