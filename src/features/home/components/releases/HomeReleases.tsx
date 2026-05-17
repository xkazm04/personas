/**
 * Top-level "What's New" view.
 *
 * Selection (which release / roadmap entry is shown) used to live in a local
 * `useState` here and be picked via the in-page `ReleasesNavBar` at the top.
 * Both moved into the sidebar Level 3 push pane on 2026-05-17 — see
 * `SidebarLevel2.tsx` → `HomeRoadmapL3`. This component now reads the
 * selection from the system store and is responsible only for rendering the
 * chosen release.
 *
 * Selection persistence:
 * - First mount → read `sessionStorage`, fall back to `releasesConfig.active`
 *   if no stored value exists. Hydrated into `systemStore.homeReleaseVersion`
 *   so the sidebar L3 highlight matches the page on cold boot.
 * - User picks a tab in the sidebar → store update + `sessionStorage` write
 *   live in the sidebar's `handleSelect` so the page stays purely read-only
 *   for selection state.
 * - Session-scoped (not localStorage) so a new session lands on the active
 *   release rather than wherever the user last clicked.
 */
import { Rocket } from 'lucide-react';
import { useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { getActiveRelease, getReleaseByVersion } from '@/data/releases';
import { useReleasesTranslation } from './i18n/useReleasesTranslation';
import ReleaseDetailView from './ReleaseDetailView';
import HomeRoadmapView from './HomeRoadmapView';
import { useLiveRoadmap } from './useLiveRoadmap';

const SELECTION_STORAGE_KEY = 'home-releases-selected-version';

function readInitialSelection(): string {
  if (typeof window === 'undefined') return getActiveRelease().version;
  try {
    const stored = window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (stored) {
      if (getReleaseByVersion(stored)) return stored;
      // Stored version no longer exists (e.g. dropped from releases.json
      // in a later build). Drop the stale value so we don't re-read it on
      // every mount and keep flashing the wrong tab before the fallback.
      window.sessionStorage.removeItem(SELECTION_STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be unavailable (e.g. SSR, sandboxed iframes) — fall back silently.
  }
  return getActiveRelease().version;
}

export default function HomeReleases() {
  const { t } = useReleasesTranslation();
  const homeReleaseVersion = useSystemStore((s) => s.homeReleaseVersion);
  const setHomeReleaseVersion = useSystemStore((s) => s.setHomeReleaseVersion);
  const live = useLiveRoadmap();

  // Hydrate the store from sessionStorage on first mount. The store default
  // is 'roadmap' (so the sidebar L3 lands on the timeline if the user just
  // clicked "What's New" with no prior session); if a stored selection
  // exists we honour it instead.
  useEffect(() => {
    const initial = readInitialSelection();
    if (initial !== useSystemStore.getState().homeReleaseVersion) {
      setHomeReleaseVersion(initial);
    }
  }, [setHomeReleaseVersion]);

  const selected = getReleaseByVersion(homeReleaseVersion) ?? getActiveRelease();

  const subtitle =
    selected.status === 'roadmap' ? t.subtitle.roadmap : t.subtitle.changelog;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Rocket className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.title}
        subtitle={subtitle}
      />
      <ContentBody centered>
        {selected.status === 'roadmap' ? (
          <HomeRoadmapView
            release={selected}
            liveOverride={live.roadmap}
            liveStatus={live.status}
            liveFetchedAt={live.fetchedAt}
            liveRefreshing={live.refreshing}
            onRefresh={live.refresh}
          />
        ) : (
          <ReleaseDetailView release={selected} />
        )}
      </ContentBody>
    </ContentBox>
  );
}
