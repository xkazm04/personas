/**
 * Thin compatibility shim for the "What's New" feature translations.
 *
 * Previously this file owned 14 per-locale bundles with a custom lazy-loader
 * and 9 `as unknown as` casts papering over key drift. All strings now live
 * in the main i18n system under `src/i18n/en.ts` → `releases.whats_new.*`.
 * Non-English locales fall back to English via the main deep-merge loader.
 *
 * The exported `useReleasesTranslation()` and `ReleasesTranslation` type are
 * kept for one cycle to avoid touching every consuming component in one go —
 * they delegate fully to `useTranslation()` with no extra caching or casting.
 */
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { releasesConfig } from '@/data/releases';

// ---------------------------------------------------------------------------
// Shape helpers
//
// Components consume `t` as a nested object (e.g. `t.status.released`,
// `t.releases['0.0.2'].items['3'].title`). We re-assemble that shape here
// from the flat keys stored in en.ts so component call-sites need no changes.
//
// The re-assembly is DERIVED, not hand-listed: the version list comes from
// `releases.json` and the item ids from the flat `release_<slug>_item_<id>_*`
// keys themselves. A hand-written map drifted silently once — release 0.0.2
// item 21 existed in `releases.json` and in `en.json` but not in the map, so
// the card rendered the literal placeholder `[0.0.2.21]` to every user.
// ---------------------------------------------------------------------------

type ReleaseItemI18n = { title: string; description: string };
type ReleaseI18n = {
  label: string;
  summary: string;
  items: Record<string, ReleaseItemI18n>;
};

export interface ReleasesTranslation {
  title: string;
  subtitle: { roadmap: string };
  /** Header label for the in-content `ReleaseNavRail`. */
  navRailLabel: string;
  status: { released: string; active: string; planned: string; roadmap: string };
  type: { feature: string; fix: string; security: string; docs: string; chore: string; breaking: string };
  itemStatus: { in_progress: string; planned: string; completed: string };
  priority: { now: string; next: string; later: string };
  live: { updatedPrefix: string; sourceCache: string; sourceStale: string; sourceFallback: string };
  /** Reserved for a roadmap with no displayable items — not wired to a surface yet. */
  empty: string;
  /** Caption under the empty-waypoint glyph in a NOW/NEXT/LATER lane with no items. */
  laneEmpty: string;
  releases: Record<string, ReleaseI18n>;
}

/** `'0.0.2'` → `'0_0_2'`; `'roadmap'` stays `'roadmap'`. Matches the flat key naming. */
function versionSlug(version: string): string {
  return version.replace(/\./g, '_');
}

/**
 * Rebuild one release's nested i18n object from the flat `whats_new` strings.
 * Returns `undefined` when the release has no `_label` key at all — a release
 * present in `releases.json` but not yet written up, which the caller skips
 * rather than rendering as an empty card.
 */
function buildRelease(flat: Record<string, string>, version: string): ReleaseI18n | undefined {
  const prefix = `release_${versionSlug(version)}`;
  const label = flat[`${prefix}_label`];
  if (label === undefined) return undefined;

  const titleKey = new RegExp(`^${prefix}_item_(.+)_title$`);
  const items: Record<string, ReleaseItemI18n> = {};
  for (const key of Object.keys(flat)) {
    const id = titleKey.exec(key)?.[1];
    if (id === undefined) continue;
    items[id] = {
      title: flat[key] ?? '',
      description: flat[`${prefix}_item_${id}_description`] ?? '',
    };
  }
  return { label, summary: flat[`${prefix}_summary`] ?? '', items };
}

export function useReleasesTranslation(): { t: ReleasesTranslation; language: string } {
  const { t: raw, language } = useTranslation();
  const r = raw.releases.whats_new;
  // The generated type models every key individually; the derived rebuild below
  // needs to enumerate them, and the section is a plain parsed object at runtime.
  const flat = r as unknown as Record<string, string>;

  // Rebuilding the nested release map means a regex sweep over every
  // `whats_new` key once per release; keep it off the render path — it only
  // changes when the language does.
  const releases = useMemo(
    () =>
      Object.fromEntries(
        releasesConfig.releases
          .map((release) => [release.version, buildRelease(flat, release.version)] as const)
          .filter((entry): entry is readonly [string, ReleaseI18n] => entry[1] !== undefined),
      ),
    // `flat` is a fresh reference every render; language is what changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  const t: ReleasesTranslation = {
    title: r.title,
    subtitle: {
      roadmap: r.subtitle_roadmap,
    },
    navRailLabel: r.nav_rail_label,
    status: {
      released: r.status_released,
      active: r.status_active,
      planned: r.status_planned,
      roadmap: r.status_roadmap,
    },
    type: {
      feature: r.type_feature,
      fix: r.type_fix,
      security: r.type_security,
      docs: r.type_docs,
      chore: r.type_chore,
      breaking: r.type_breaking,
    },
    itemStatus: {
      in_progress: r.item_status_in_progress,
      planned: r.item_status_planned,
      completed: r.item_status_completed,
    },
    priority: {
      now: r.priority_now,
      next: r.priority_next,
      later: r.priority_later,
    },
    live: {
      updatedPrefix: r.live_updated_prefix,
      sourceCache: r.live_source_cache,
      sourceStale: r.live_source_stale,
      sourceFallback: r.live_source_fallback,
    },
    empty: r.empty,
    laneEmpty: r.lane_empty,
    releases,
  };

  return { t, language };
}
