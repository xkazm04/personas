/**
 * In-content release picker for Home → "What's New".
 *
 * A left rail that lists each release plus the roadmap entry, scoping the
 * content pane to the right. This replaced the sidebar Level 3 push pane
 * (`HomeRoadmapL3`) on 2026-06-09 so the Home Level 2 list stays visible while
 * the user browses releases. Selection is held in `systemStore.homeReleaseVersion`
 * and persisted to `sessionStorage` via {@link persistReleaseSelection}.
 */
import { useCallback, useMemo } from 'react';
import { Map as MapIcon, Rocket } from 'lucide-react';
import { getNavReleases, RELEASE_STATUS_META, type Release } from '@/data/releases';
import { useSystemStore } from '@/stores/systemStore';
import { useReleasesTranslation } from './i18n/useReleasesTranslation';
import { persistReleaseSelection } from './releaseSelection';

interface RailItem {
  id: string;
  isRoadmap: boolean;
  label: string;
  statusLabel: string;
  statusMeta: (typeof RELEASE_STATUS_META)[keyof typeof RELEASE_STATUS_META];
}

export default function ReleaseNavRail() {
  const { t } = useReleasesTranslation();
  const homeReleaseVersion = useSystemStore((s) => s.homeReleaseVersion);
  const setHomeReleaseVersion = useSystemStore((s) => s.setHomeReleaseVersion);
  const navReleases = useMemo(() => getNavReleases(), []);

  const items = useMemo<RailItem[]>(
    () =>
      navReleases.map((release: Release) => {
        const isRoadmap = release.status === 'roadmap';
        const releaseI18n = t.releases[release.version as keyof typeof t.releases];
        const label = isRoadmap
          ? t.navBar.roadmapLabel
          : releaseI18n?.label
            ? `${releaseI18n.label} (${release.version})`
            : release.version;
        return {
          id: release.version,
          isRoadmap,
          label,
          statusLabel: t.status[release.status],
          statusMeta: RELEASE_STATUS_META[release.status],
        };
      }),
    [navReleases, t],
  );

  const handleSelect = useCallback(
    (version: string) => {
      setHomeReleaseVersion(version);
      persistReleaseSelection(version);
    },
    [setHomeReleaseVersion],
  );

  return (
    <aside className="flex w-52 flex-shrink-0 flex-col border-r border-primary/10 bg-secondary/20">
      <div className="px-4 py-3 border-b border-primary/10">
        <span className="typo-label text-foreground/90">{t.navRailLabel}</span>
      </div>
      <nav
        className="flex-1 space-y-0.5 overflow-y-auto p-2"
        role="tablist"
        aria-label={t.navRailLabel}
      >
        {items.map((item) => {
          const Icon = item.isRoadmap ? MapIcon : Rocket;
          const isActive = homeReleaseVersion === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleSelect(item.id)}
              className={`flex w-full items-start gap-2.5 rounded-card px-3 py-2 text-left typo-heading transition-colors ${
                isActive
                  ? 'bg-primary/10 font-semibold text-foreground'
                  : 'font-normal text-foreground/70 hover:bg-secondary/40 hover:text-foreground'
              }`}
            >
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                {!item.isRoadmap && (
                  <span
                    className={[
                      'mt-1 inline-flex rounded-full border px-1.5 py-0.5 typo-caption font-semibold uppercase tracking-wider',
                      item.statusMeta.badgeBg,
                      item.statusMeta.badgeText,
                      item.statusMeta.badgeBorder,
                    ].join(' ')}
                  >
                    {item.statusLabel}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
