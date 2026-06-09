/**
 * Top-level "What's New" view.
 *
 * Layout: a left `ReleaseNavRail` (release picker) beside the content pane.
 * The rail replaced the sidebar Level 3 push pane on 2026-06-09 — selection
 * now lives next to the content it scopes, and the Home Level 2 list stays
 * visible throughout. This component reads the selected version from the
 * system store and renders the chosen release; the rail owns writes.
 *
 * Selection persistence (see `releaseSelection.ts`):
 * - First mount → read `sessionStorage`, fall back to the active release.
 *   Hydrated into `systemStore.homeReleaseVersion` so the rail highlight
 *   matches the page on cold boot.
 * - Session-scoped (not localStorage) so a new session lands on the active
 *   release rather than wherever the user last clicked.
 *
 * Viewing this page acknowledges the running app version (clears the
 * "What's New" update dot on the Home / Roadmap sidebar entries).
 *
 * i18n: see `.claude/CLAUDE.md` → "Internationalization".
 */
import { Rocket } from 'lucide-react';
import { useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useWhatsNewIndicator } from '@/hooks/sidebar/useWhatsNewIndicator';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { getActiveRelease, getReleaseByVersion } from '@/data/releases';
import { useReleasesTranslation } from './i18n/useReleasesTranslation';
import ReleaseDetailView from './ReleaseDetailView';
import ReleaseNavRail from './ReleaseNavRail';
import HomeRoadmapView from './HomeRoadmapView';
import { useLiveRoadmap } from './useLiveRoadmap';
import { readInitialReleaseSelection } from './releaseSelection';

export default function HomeReleases() {
  const { t } = useReleasesTranslation();
  const homeReleaseVersion = useSystemStore((s) => s.homeReleaseVersion);
  const setHomeReleaseVersion = useSystemStore((s) => s.setHomeReleaseVersion);
  const live = useLiveRoadmap();
  const { dismiss: dismissWhatsNew } = useWhatsNewIndicator();

  // Hydrate the store from sessionStorage on first mount. The store default
  // is 'roadmap' (so a fresh visit lands on the timeline); a stored selection
  // is honoured instead when present.
  useEffect(() => {
    const initial = readInitialReleaseSelection();
    if (initial !== useSystemStore.getState().homeReleaseVersion) {
      setHomeReleaseVersion(initial);
    }
  }, [setHomeReleaseVersion]);

  // Reaching the "What's New" page is the natural acknowledgement of an
  // update — clear the dot. `dismiss` is a no-op until the app version loads,
  // then its identity changes and this effect re-runs to record it.
  useEffect(() => {
    dismissWhatsNew();
  }, [dismissWhatsNew]);

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
      <div className="flex flex-1 min-h-0">
        <ReleaseNavRail />
        <ContentBody>
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
      </div>
    </ContentBox>
  );
}
