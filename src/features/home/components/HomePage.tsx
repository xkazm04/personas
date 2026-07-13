import { lazy, Suspense, useRef, type ReactNode } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import type { HomeTab } from '@/lib/types/types';
import { SystemHealthPanel } from '@/features/overview/components/health/SystemHealthPanel';
import HomeWelcome from '@/features/home/sub_welcome/HomeWelcome';

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
  const devSystemCheck = import.meta.env.DEV;

  // The effective active tab. `system-check` is DEV-only; outside DEV it falls
  // back to the Welcome surface (matching the previous behavior).
  const activeTab: HomeTab = homeTab === 'system-check' && !devSystemCheck ? 'welcome' : homeTab;

  // Track which tabs have EVER been active. Only visited tabs are mounted, so
  // the first paint mounts Welcome alone (the default) — cockpit/roadmap/learning
  // stay off the tree until the user opens them, preserving the lazy-load +
  // WebView2 node-commit discipline. Once visited, a tab stays mounted (hidden)
  // for the session.
  const visitedRef = useRef<Set<HomeTab>>(new Set());
  visitedRef.current.add(activeTab);
  const visited = visitedRef.current;

  const fallback = (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {visited.has('welcome') && (
        <KeepAlivePane active={activeTab === 'welcome'}>
          <HomeWelcome />
        </KeepAlivePane>
      )}
      {visited.has('cockpit') && (
        <KeepAlivePane active={activeTab === 'cockpit'}>
          <Suspense fallback={fallback}><Cockpit /></Suspense>
        </KeepAlivePane>
      )}
      {visited.has('roadmap') && (
        <KeepAlivePane active={activeTab === 'roadmap'}>
          <Suspense fallback={fallback}><HomeReleases /></Suspense>
        </KeepAlivePane>
      )}
      {visited.has('learning') && (
        <KeepAlivePane active={activeTab === 'learning'}>
          <Suspense fallback={fallback}><HomeLearning /></Suspense>
        </KeepAlivePane>
      )}
      {devSystemCheck && visited.has('system-check') && (
        <KeepAlivePane active={activeTab === 'system-check'}>
          <SystemHealthPanel />
        </KeepAlivePane>
      )}
    </div>
  );
}
