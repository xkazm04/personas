/**
 * Pure roadmap display-item builder — extracted from the former
 * `HomeRoadmapView` so the lean `HomeReleases` view stays presentational.
 *
 * Resolves the roadmap's items from the live-fetched payload when present,
 * else the bundled `releases.json` + i18n. The live→bundled fallback (a
 * schema-valid but content-empty live payload must not blank the roadmap)
 * is preserved here as part of the live-roadmap resilience contract.
 *
 * Framework-free + side-effect-light (only Sentry breadcrumbs) so it can be
 * unit-tested independently of React.
 */
import * as Sentry from '@sentry/react';
import type { Release, ReleaseItem, ReleaseItemPriority, ReleaseItemStatus } from '@/data/releases';
import type { LiveRoadmap, LiveRoadmapItem } from '@/api/liveRoadmap';

export interface DisplayItem {
  id: string;
  title: string;
  description: string;
  status: ReleaseItemStatus;
  priority: ReleaseItemPriority;
  sort_order: number;
}

export const ROADMAP_PRIORITIES: ReleaseItemPriority[] = ['now', 'next', 'later'];
const KNOWN_STATUSES: ReadonlySet<ReleaseItemStatus> = new Set(['in_progress', 'planned', 'completed']);
const KNOWN_PRIORITIES: ReadonlySet<ReleaseItemPriority> = new Set(['now', 'next', 'later']);

type ItemI18n = Record<string, { title: string; description: string }> | undefined;

/**
 * Narrow a server-supplied status to one this build knows. Unknown → 'planned'
 * (a visible demotion, not a drop) with a Sentry breadcrumb so schema drift is
 * observable. Same forward-compat policy for {@link narrowPriority} → 'later'.
 */
function narrowStatus(raw: string | null | undefined, itemId?: string): ReleaseItemStatus {
  if (raw && KNOWN_STATUSES.has(raw as ReleaseItemStatus)) return raw as ReleaseItemStatus;
  if (raw) {
    Sentry.addBreadcrumb({
      category: 'live-roadmap',
      message: `narrowStatus: unknown value '${raw}' coerced to 'planned'`,
      level: 'info',
      data: itemId ? { itemId } : undefined,
    });
  }
  return 'planned';
}

function narrowPriority(raw: string | null | undefined, itemId?: string): ReleaseItemPriority {
  if (raw && KNOWN_PRIORITIES.has(raw as ReleaseItemPriority)) return raw as ReleaseItemPriority;
  if (raw) {
    Sentry.addBreadcrumb({
      category: 'live-roadmap',
      message: `narrowPriority: unknown value '${raw}' coerced to 'later'`,
      level: 'info',
      data: itemId ? { itemId } : undefined,
    });
  }
  return 'later';
}

/** Drop duplicate ids (server content can ship them), keeping the first. */
function dedupeById(items: DisplayItem[]): DisplayItem[] {
  const seen = new Set<string>();
  const out: DisplayItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      Sentry.addBreadcrumb({
        category: 'live-roadmap',
        message: `dedupeById: dropped duplicate id '${item.id}'`,
        level: 'warning',
      });
      continue;
    }
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** Has real content — a non-empty title that isn't the missing-content marker. */
function isDisplayable(item: DisplayItem): boolean {
  return item.title.trim().length > 0 && item.title !== `[roadmap.${item.id}]`;
}

/**
 * Drop the items that have no content. `isDisplayable` used to be consulted
 * only as an all-or-nothing question about the LIVE payload ("did it yield
 * anything at all?"), which left both paths free to render individual
 * content-less items as the literal marker `[roadmap.<id>]` — a live payload
 * with one new item the locale bundle has not caught up with, or a bundled
 * release item with no `release_roadmap_item_<id>_title` key. That exact
 * class of leak has shipped here before: `useReleasesTranslation` carries the
 * scar of `[0.0.2.21]` reaching every user. A marker is never content, so it
 * is dropped rather than displayed, and the drop is instrumented — the empty
 * result is an honest empty roadmap, not a wall of broken tokens.
 */
function keepDisplayable(items: DisplayItem[], source: 'live' | 'bundled'): DisplayItem[] {
  const kept = items.filter(isDisplayable);
  if (kept.length !== items.length) {
    Sentry.addBreadcrumb({
      category: 'live-roadmap',
      message: `keepDisplayable: dropped ${items.length - kept.length} ${source} item(s) with no content`,
      level: 'warning',
      data: { ids: items.filter((i) => !isDisplayable(i)).map((i) => i.id) },
    });
  }
  return kept;
}

function fromBundled(item: ReleaseItem, fallbackOrder: number, i18n: ItemI18n): DisplayItem {
  const entry = i18n?.[item.id];
  return {
    id: item.id,
    title: entry?.title ?? `[roadmap.${item.id}]`,
    description: entry?.description ?? '',
    status: item.status ?? 'planned',
    priority: item.priority ?? 'later',
    sort_order: item.sort_order ?? fallbackOrder,
  };
}

function fromLive(
  item: LiveRoadmapItem,
  fallbackOrder: number,
  locale: LiveRoadmap['i18n'][string] | undefined,
): DisplayItem {
  const content = locale?.items[item.id];
  return {
    id: item.id,
    title: content?.title ?? `[roadmap.${item.id}]`,
    description: content?.description ?? '',
    status: narrowStatus(item.status, item.id),
    priority: narrowPriority(item.priority, item.id),
    sort_order: item.sortOrder ?? fallbackOrder,
  };
}

function buildBundledItems(release: Release, i18n: ItemI18n): DisplayItem[] {
  const built = release.items.map((item, idx) => fromBundled(item, idx + 1, i18n));
  return dedupeById(built).sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Resolve roadmap items: live payload wins, but a live payload that yields
 * zero displayable items falls back to bundled content so a single
 * content-author mistake can't blank the roadmap for every client.
 */
export function buildDisplayItems(
  release: Release,
  liveOverride: LiveRoadmap | null | undefined,
  language: string,
  bundledItems: ItemI18n,
): DisplayItem[] {
  if (liveOverride) {
    const locale = liveOverride.i18n[language] ?? liveOverride.i18n.en;
    const built = dedupeById(
      liveOverride.release.items.map((item, idx) => fromLive(item, idx + 1, locale)),
    ).sort((a, b) => a.sort_order - b.sort_order);
    if (built.some(isDisplayable)) return keepDisplayable(built, 'live');
    Sentry.addBreadcrumb({
      category: 'live-roadmap',
      message: 'buildDisplayItems: live payload yielded zero displayable items; falling back to bundled content',
      level: 'warning',
    });
  }
  return keepDisplayable(buildBundledItems(release, bundledItems), 'bundled');
}
