/**
 * Top-level "What's New" view.
 *
 * Owns the selection state for which release tab is open and routes to either
 * the standard changelog detail view or the special roadmap timeline view.
 *
 * Selection persistence:
 * - First mount → falls back to `releasesConfig.active`
 * - User picks a tab → stored in `sessionStorage` so navigating away/back
 *   keeps the view stable inside the session
 * - Persistence is intentionally session-scoped (not localStorage) so the
 *   user always lands on the active release at the start of a new session
 */
import { Rocket } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { getActiveRelease, getNavReleases, getReleaseByVersion } from '@/data/releases';
import { ReleasesNavBar } from './ReleasesNavBar';
import ReleaseDetailView from './ReleaseDetailView';
import HomeRoadmapView from './HomeRoadmapView';

const SELECTION_STORAGE_KEY = 'home-releases-selected-version';

function readInitialSelection(): string {
  if (typeof window === 'undefined') return getActiveRelease().version;
  try {
    const stored = window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (stored && getReleaseByVersion(stored)) return stored;
  } catch {
    // sessionStorage may be unavailable (e.g. SSR, sandboxed iframes) — fall back silently.
  }
  return getActiveRelease().version;
}

export default function HomeReleases() {
  const [selectedVersion, setSelectedVersion] = useState<string>(() => readInitialSelection());

  const navReleases = getNavReleases();
  const selected = getReleaseByVersion(selectedVersion) ?? getActiveRelease();

  const handleSelect = useCallback((version: string) => {
    setSelectedVersion(version);
    try {
      window.sessionStorage.setItem(SELECTION_STORAGE_KEY, version);
    } catch {
      // Storage may be unavailable; selection still works in-memory.
    }
  }, []);

  const subtitle =
    selected.status === 'roadmap'
      ? "What we're building now and what comes next."
      : 'Release notes and changelog for the desktop app.';

  return (
    <ContentBox>
      <ContentHeader
        icon={<Rocket className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="What's New"
        subtitle={subtitle}
      />
      <ReleasesNavBar
        releases={navReleases}
        selectedVersion={selected.version}
        onSelect={handleSelect}
      />
      <ContentBody centered>
        {selected.status === 'roadmap' ? (
          <HomeRoadmapView release={selected} />
        ) : (
          <ReleaseDetailView release={selected} />
        )}
      </ContentBody>
    </ContentBox>
  );
}
