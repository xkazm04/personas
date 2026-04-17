/**
 * Top-bar navigation for the "What's New" view.
 *
 * Renders one pill per release returned by `getNavReleases()`. The active
 * release shows a "Current" status badge; the special roadmap entry uses an
 * outline arrow to signal it's a forward-looking view rather than a release.
 *
 * All labels are looked up via `useReleasesTranslation` (backed by the main
 * i18n system at `src/i18n/en.ts` → `releases.whats_new.*`). Per project
 * convention, no English strings live in this file directly.
 * See `.claude/CLAUDE.md` → "Internationalization".
 */
import { ArrowRight } from 'lucide-react';
import type { Release } from '@/data/releases';
import { RELEASE_STATUS_META } from '@/data/releases';
import { useReleasesTranslation } from './i18n/useReleasesTranslation';

interface ReleasesNavBarProps {
  releases: Release[];
  selectedVersion: string;
  onSelect: (version: string) => void;
}

export function ReleasesNavBar({ releases, selectedVersion, onSelect }: ReleasesNavBarProps) {
  const { t } = useReleasesTranslation();

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-primary/8 px-4 py-3"
      role="tablist"
      aria-label={t.title}
    >
      {releases.map((release) => {
        const isSelected = release.version === selectedVersion;
        const isRoadmap = release.status === 'roadmap';
        const meta = RELEASE_STATUS_META[release.status];
        const releaseI18n = t.releases[release.version as keyof typeof t.releases];
        const label = isRoadmap
          ? t.navBar.roadmapLabel
          : releaseI18n?.label
            ? `${releaseI18n.label} (${release.version})`
            : release.version;
        const statusLabel = t.status[release.status];

        return (
          <button
            key={release.version}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(release.version)}
            // Both selected and inactive states use full-contrast `text-foreground`
            // (white in dark themes, black in light) — selection is communicated via
            // border + background + an accent ring on selected, NOT by muting the
            // unselected text. See CLAUDE.md UI Conventions: never use muted/transparent
            // text as the primary readability layer.
            className={[
              'group flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium text-foreground transition-all duration-150',
              isSelected
                ? 'border-primary/40 bg-primary/15 shadow-[0_0_12px_color-mix(in_oklab,var(--primary)_25%,transparent)]'
                : 'border-primary/10 bg-primary/[0.03] hover:border-primary/20 hover:bg-primary/[0.06]',
            ].join(' ')}
          >
            <span className="font-mono tracking-tight">{label}</span>

            {/* Status badge — hidden on the special roadmap entry to keep it visually distinct */}
            {!isRoadmap && (
              <span
                className={[
                  'rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                  meta.badgeBg,
                  meta.badgeText,
                  meta.badgeBorder,
                ].join(' ')}
              >
                {statusLabel}
              </span>
            )}

            {/* Roadmap entry shows an arrow to signal the unique forward-looking view */}
            {isRoadmap && (
              <ArrowRight
                className={`h-3 w-3 transition-transform ${isSelected ? 'translate-x-0.5' : 'group-hover:translate-x-0.5'}`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
