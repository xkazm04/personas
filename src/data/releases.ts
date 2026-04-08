/**
 * Release log ("What's New") — typed access layer over `releases.json`.
 *
 * The JSON is the structural source of truth (versions, item ids, types,
 * statuses, dates). All user-facing strings — labels, titles, descriptions,
 * summaries — live in the per-feature i18n folder at
 * `src/features/home/components/releases/i18n/{lang}.ts` and are looked up
 * by `version` + `item.id`.
 *
 * Why split: release item content is user-facing news. It must follow the
 * project i18n convention (every string in all 14 locale files, never
 * hardcoded English). The structural metadata (status, type, dates) is
 * code, not content, and stays in JSON for diff-friendliness.
 *
 * Schema invariants:
 * - `active` MUST reference an existing release.version
 * - The "roadmap" entry has status='roadmap' and is rendered with a unique UI
 *   (the legacy timeline). Other entries render as a standard changelog.
 * - Items inside a roadmap-status release carry `priority` + `sort_order`;
 *   items inside a normal release use `status='completed' | 'in_progress'`
 *   and an optional `added_at` timestamp.
 */

import rawReleases from './releases.json';

// =============================================================================
// Types
// =============================================================================

export type ReleaseItemType =
  | 'feature'
  | 'fix'
  | 'security'
  | 'docs'
  | 'chore'
  | 'breaking';

export type ReleaseItemStatus = 'completed' | 'in_progress' | 'planned';

/** Roadmap-only priority bucketing — ignored for normal release items. */
export type ReleaseItemPriority = 'now' | 'next' | 'later';

export type ReleaseStatus = 'released' | 'active' | 'planned' | 'roadmap';

/**
 * Structural metadata for a release item. The user-facing title/description
 * live in the i18n locale files (looked up by `release.version` + `item.id`).
 */
export interface ReleaseItem {
  /** Unique within its release. Looked up in i18n as `releases[version].items[id]`. */
  id: string;
  type: ReleaseItemType;
  status?: ReleaseItemStatus;
  /** Roadmap-only. */
  priority?: ReleaseItemPriority;
  /** Roadmap-only. Determines visual ordering of the timeline. */
  sort_order?: number;
  /** ISO date string when the item was logged. */
  added_at?: string;
}

export interface Release {
  version: string;
  status: ReleaseStatus;
  released_at?: string;
  items: ReleaseItem[];
}

export interface ReleasesConfig {
  active: string;
  releases: Release[];
}

// =============================================================================
// Loaded config (typed)
// =============================================================================

export const releasesConfig: ReleasesConfig = rawReleases as ReleasesConfig;

// =============================================================================
// Selectors
// =============================================================================

/**
 * Find a release by its version id. Returns `undefined` for unknown versions
 * so the UI can fall back to the active release.
 */
export function getReleaseByVersion(version: string): Release | undefined {
  return releasesConfig.releases.find((r) => r.version === version);
}

/**
 * The release that opens by default when the user lands on "What's New".
 * Falls back to the first non-roadmap release if `active` references an
 * unknown version.
 *
 * The empty-config case is treated as a build error: the JSON ships with
 * the bundle and is validated by the schema, so an empty `releases` array
 * indicates the file was deliberately broken.
 */
export function getActiveRelease(): Release {
  const explicit = getReleaseByVersion(releasesConfig.active);
  if (explicit) return explicit;
  const fallback = releasesConfig.releases.find((r) => r.status !== 'roadmap');
  if (fallback) return fallback;
  const first = releasesConfig.releases[0];
  if (!first) {
    throw new Error('releases.json contains no releases — this is a build error');
  }
  return first;
}

/**
 * Return the most recent N releases, plus the special "roadmap" entry if
 * present. Used by the top-bar navigation.
 *
 * Order:
 *   1. Active release first (visually the default)
 *   2. Other non-roadmap releases, newest first (by released_at, then by
 *      array order as a tiebreaker)
 *   3. Roadmap entry last (acts like a "future" bucket on the right)
 *
 * Cap: at most `limit` non-roadmap entries (default 10) to keep the bar lean.
 */
export function getNavReleases(limit = 10): Release[] {
  const all = releasesConfig.releases;
  const roadmap = all.find((r) => r.status === 'roadmap');
  const normal = all.filter((r) => r.status !== 'roadmap');

  // Stable sort: active first, then by released_at desc, then by source order.
  const sorted = [...normal].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    const aDate = a.released_at ?? '';
    const bDate = b.released_at ?? '';
    if (aDate && bDate) return bDate.localeCompare(aDate);
    if (aDate) return -1;
    if (bDate) return 1;
    return 0;
  });

  const trimmed = sorted.slice(0, limit);
  return roadmap ? [...trimmed, roadmap] : trimmed;
}

// =============================================================================
// Item type / status visual metadata
//
// Only color tokens live here — labels are i18n strings, looked up via
// `useReleasesTranslation` in the components.
// =============================================================================

export const RELEASE_TYPE_META: Record<
  ReleaseItemType,
  { badgeBg: string; badgeText: string; badgeBorder: string }
> = {
  feature: {
    badgeBg: 'bg-cyan-500/10',
    badgeText: 'text-cyan-400',
    badgeBorder: 'border-cyan-500/20',
  },
  fix: {
    badgeBg: 'bg-emerald-500/10',
    badgeText: 'text-emerald-400',
    badgeBorder: 'border-emerald-500/20',
  },
  security: {
    badgeBg: 'bg-red-500/10',
    badgeText: 'text-red-400',
    badgeBorder: 'border-red-500/20',
  },
  docs: {
    badgeBg: 'bg-blue-500/10',
    badgeText: 'text-blue-400',
    badgeBorder: 'border-blue-500/20',
  },
  chore: {
    badgeBg: 'bg-secondary/50',
    badgeText: 'text-foreground',
    badgeBorder: 'border-primary/10',
  },
  breaking: {
    badgeBg: 'bg-orange-500/10',
    badgeText: 'text-orange-400',
    badgeBorder: 'border-orange-500/20',
  },
};

export const RELEASE_STATUS_META: Record<
  ReleaseStatus,
  { badgeBg: string; badgeText: string; badgeBorder: string }
> = {
  released: {
    badgeBg: 'bg-emerald-500/10',
    badgeText: 'text-emerald-400',
    badgeBorder: 'border-emerald-500/20',
  },
  active: {
    badgeBg: 'bg-cyan-500/10',
    badgeText: 'text-cyan-400',
    badgeBorder: 'border-cyan-500/20',
  },
  planned: {
    badgeBg: 'bg-purple-500/10',
    badgeText: 'text-purple-400',
    badgeBorder: 'border-purple-500/20',
  },
  roadmap: {
    badgeBg: 'bg-secondary/50',
    badgeText: 'text-foreground',
    badgeBorder: 'border-primary/10',
  },
};
