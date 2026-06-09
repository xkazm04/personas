/**
 * Selection persistence for the Home → "What's New" surface.
 *
 * The selected release version is held in `systemStore.homeReleaseVersion` for
 * reactivity and mirrored to `sessionStorage` so it survives navigating away
 * from Home and back within a session (but resets to the active release on a
 * fresh launch). Both the in-content `ReleaseNavRail` (writer) and
 * `HomeReleases` (initial hydrate) go through these helpers — previously the
 * read lived in `HomeReleases` and the write in `SidebarLevel2`'s now-removed
 * Level 3 pane.
 */
import { getActiveRelease, getReleaseByVersion } from '@/data/releases';
import { silentCatch } from '@/lib/silentCatch';

export const SELECTION_STORAGE_KEY = 'home-releases-selected-version';

/**
 * Resolve the version to show on first mount: a still-valid stored selection,
 * else the active release. Drops a stale stored version (one dropped from
 * `releases.json` in a later build) so it isn't re-read on every mount.
 */
export function readInitialReleaseSelection(): string {
  if (typeof window === 'undefined') return getActiveRelease().version;
  try {
    const stored = window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (stored) {
      if (getReleaseByVersion(stored)) return stored;
      window.sessionStorage.removeItem(SELECTION_STORAGE_KEY);
    }
  } catch (err) {
    silentCatch('releaseSelection:read')(err);
  }
  return getActiveRelease().version;
}

export function persistReleaseSelection(version: string): void {
  try {
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, version);
  } catch (err) {
    silentCatch('releaseSelection:persist')(err);
  }
}
