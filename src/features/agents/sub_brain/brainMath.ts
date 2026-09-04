import type { CoverageCell } from '@/lib/bindings/CoverageCell';
import type { ConsolidationPoint } from '@/lib/bindings/ConsolidationPoint';
import type { EpisodeDayCount } from '@/lib/bindings/EpisodeDayCount';
import type { MemoryTierCounts } from '@/lib/bindings/MemoryTierCounts';

/**
 * Pure shaping for the Brain dashboard. No React, no IPC — every function here
 * turns one aggregate from `PersonaBrainDashboard` into the row shape a chart
 * or a tile reads, and each one is explicit about the difference between
 * "measured zero" and "never happened".
 */

/** The four roles `engine::persona_brain::episodes::EpisodeRole` mints. */
export const EPISODE_ROLES = ['run', 'channel', 'operator', 'system'] as const;
export type EpisodeRoleKey = (typeof EPISODE_ROLES)[number];
/** Anything the backend later starts minting folds here — never a new hue. */
export const OTHER_ROLE = 'other';

export interface EpisodeDayRow {
  day: string;
  run: number;
  channel: number;
  operator: number;
  system: number;
  other: number;
  total: number;
  chars: number;
}

/**
 * YYYY-MM-DD in a NAMED zone. Every day key, gap-fill and axis label in this
 * dashboard goes through here, and the zone is UTC because that is the zone the
 * server already bucketed in (`GROUP BY date(created_at)` in SQLite is UTC).
 * Naming it is the point: an implicit `toISOString().slice(0, 10)` reads as "the
 * day" while silently meaning "UTC's day", so a reader cannot tell whether keys
 * and labels agree. One zone, stated once, used for keys and labels alike.
 */
export const dayKey = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: DAY_KEY_ZONE }).format(d);

export const DAY_KEY_ZONE = 'UTC';

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return dayKey(d);
};

/**
 * `GROUP BY day, role` rows → one row per UTC day, oldest first.
 *
 * Days between the first recorded day and `today` that carry no row are filled
 * with zeros: the query covered them, so their emptiness is measured, and a
 * gap-free axis is what makes "nothing for a week" legible. Nothing is
 * fabricated BEFORE the first recorded day — the window's true start is not on
 * the wire, so inventing leading zeros would assert a silence we did not
 * measure.
 */
export function pivotEpisodeSeries(rows: EpisodeDayCount[], today: string): EpisodeDayRow[] {
  if (rows.length === 0) return [];
  const byDay = new Map<string, EpisodeDayRow>();
  const blank = (day: string): EpisodeDayRow => ({
    day, run: 0, channel: 0, operator: 0, system: 0, other: 0, total: 0, chars: 0,
  });
  for (const r of rows) {
    const row = byDay.get(r.day) ?? blank(r.day);
    const key = (EPISODE_ROLES as readonly string[]).includes(r.role)
      ? (r.role as EpisodeRoleKey)
      : OTHER_ROLE;
    row[key] += r.count;
    row.total += r.count;
    row.chars += r.chars;
    byDay.set(r.day, row);
  }
  const days = [...byDay.keys()].sort();
  const first = days[0]!;
  const last = today > days[days.length - 1]! ? today : days[days.length - 1]!;
  const out: EpisodeDayRow[] = [];
  for (let d = first; d <= last; d = nextDay(d)) {
    out.push(byDay.get(d) ?? blank(d));
    if (out.length > 400) break; // guard against a malformed `today`
  }
  return out;
}

/** Which role series actually carry a value — a series of pure zeros is not drawn. */
export function presentRoles(rows: EpisodeDayRow[]): Array<EpisodeRoleKey | typeof OTHER_ROLE> {
  const keys: Array<EpisodeRoleKey | typeof OTHER_ROLE> = [...EPISODE_ROLES, OTHER_ROLE];
  return keys.filter((k) => rows.some((r) => r[k] > 0));
}

export interface ConsolidationSummary {
  /** Passes on the wire, oldest first (the repo already reverses). */
  points: ConsolidationPoint[];
  episodesFed: number;
  created: number;
  updated: number;
  rejected: number;
  skippedTombstoned: number;
  selfModelDiffsProposed: number;
  /** `null` when NO pass reported a cost — subscription lane, not $0. */
  costUsd: number | null;
  /** Share of fed episodes that became a memory write, or `null` when none fed. */
  yieldRatio: number | null;
}

export function summarizeConsolidation(points: ConsolidationPoint[]): ConsolidationSummary {
  const sum = (pick: (p: ConsolidationPoint) => number) =>
    points.reduce((n, p) => n + pick(p), 0);
  // The predicate IS the narrowing. `costUsd` is optional on the wire and its
  // absence means the subscription lane, not $0 — so the total below adds only
  // amounts a pass actually reported, with no `?? 0` in between to make an
  // unreported cost indistinguishable from a free one.
  const priced = points.filter(
    (p): p is ConsolidationPoint & { costUsd: number } => p.costUsd != null,
  );
  const episodesFed = sum((p) => p.episodesFed);
  const created = sum((p) => p.created);
  const updated = sum((p) => p.updated);
  return {
    points,
    episodesFed,
    created,
    updated,
    rejected: sum((p) => p.rejected),
    skippedTombstoned: sum((p) => p.skippedTombstoned),
    selfModelDiffsProposed: sum((p) => p.selfModelDiffsProposed),
    costUsd: priced.length === 0 ? null : priced.reduce((n, p) => n + p.costUsd, 0),
    yieldRatio: episodesFed === 0 ? null : (created + updated) / episodesFed,
  };
}

export type TierKey = keyof MemoryTierCounts;
export const TIER_ORDER: TierKey[] = ['core', 'active', 'working', 'archived'];

export function tierTotal(tiers: MemoryTierCounts): number {
  return TIER_ORDER.reduce((n, k) => n + tiers[k], 0);
}

export interface CoverageRow {
  /** Charter id, or the `unassigned` sentinel. */
  key: string;
  /** Charter title, the unassigned label, or `null` when the charter is gone. */
  title: string | null;
  /**
   * `null` when NO coverage cell named this key — "the read said nothing about
   * this charter", which is not the claim "this charter has zero episodes".
   * Only a cell the backend actually returned carries a number, so a consumer
   * cannot render an unmeasured charter as a measured `0`.
   */
  count: number | null;
  kind: 'charter' | 'unassigned' | 'orphan';
}

export interface CoverageSplit {
  /** Charters the brain holds episodes for, busiest first. */
  covered: CoverageRow[];
  /** **The point of the tile**: live charters with NOTHING recorded. */
  uncovered: CoverageRow[];
  /** Episodes that landed under no charter at all. */
  unassigned: CoverageRow | null;
  /** Cells whose charter no longer exists (retired or deleted). */
  orphans: CoverageRow[];
}

/**
 * Join the coverage cells against the live charter roster.
 *
 * A list of cells can only ever show what IS there; the absence set is the
 * difference against the roster, which is why the roster is fetched alongside.
 */
export function splitCoverage(
  cells: CoverageCell[],
  charters: Array<{ id: string; title: string }>,
): CoverageSplit {
  const counts = new Map(cells.map((c) => [c.key, c.count]));
  const covered: CoverageRow[] = [];
  const uncovered: CoverageRow[] = [];
  for (const c of charters) {
    // A charter the coverage read never named stays UNMEASURED. Materialising
    // the miss as 0 here would be irreversible — no consumer downstream could
    // tell "nothing recorded" from "recorded nothing" again.
    const measured = counts.get(c.id);
    const row: CoverageRow = { key: c.id, title: c.title, count: measured ?? null, kind: 'charter' };
    (measured != null && measured > 0 ? covered : uncovered).push(row);
  }
  // Every row in `covered` came from a cell, so its count is a number; the
  // fallback is the ordering identity, not a displayed claim.
  covered.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.key.localeCompare(b.key));
  uncovered.sort((a, b) => (a.title ?? a.key).localeCompare(b.title ?? b.key));
  const known = new Set(charters.map((c) => c.id));
  const orphans = cells
    .filter((c) => c.key !== 'unassigned' && !known.has(c.key))
    .map<CoverageRow>((c) => ({ key: c.key, title: null, count: c.count, kind: 'orphan' }));
  const unassignedCount = counts.get('unassigned');
  return {
    covered,
    uncovered,
    orphans,
    unassigned:
      unassignedCount == null
        ? null
        : { key: 'unassigned', title: null, count: unassignedCount, kind: 'unassigned' },
  };
}
