// Pure join/merge helpers for the Coverage lane (registry-coverage-ui R2).
//
// The Rust reader (`dev_tools_registry_coverage`) carries the registry-side
// half of every dimension; this module merges the app-DB half on top:
// harvest coverage (`workspace_harvest_coverage`) for extraction and practice
// adoption (`workspace_practice_adoption`) for the applied dimension, plus
// their clocks into the staleness merge.
//
// Doctrine (plan D2/D5, the adherence lesson): **absence is not signal**. A
// dimension with nothing behind it renders "no signal", never a zero that
// reads as good — and "in sync" is EARNED: it requires every dimension to
// carry a real signal AND zero derived debts. Absence of debts alone is not
// health.
import type { CoverageTile } from '@/lib/bindings/CoverageTile';
import type { WorkspaceHarvestCoverage } from '@/lib/bindings/WorkspaceHarvestCoverage';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';

/** Harvest ledger rolled up across a project's scopes. `null` upstream (no
 *  rows at all / fetch failed) means "no signal"; a rollup with
 *  `scopesHarvested === 0` means "looked, never harvested" — different claims. */
export interface HarvestRollup {
  /** Max `last_harvested_at` across scopes; null when no scope was ever harvested. */
  lastHarvestedAt: string | null;
  /** Sum of the most recent run's items across scopes. */
  itemsFound: number;
  /** Sum of run counts across scopes. */
  runCount: number;
  scopesHarvested: number;
  scopesTotal: number;
}

/** Practice adoption rolled up for one project. `null` upstream = no rows =
 *  no signal (the project may simply not be in a workspace). */
export interface PracticeRollup {
  adopted: number;
  diverged: number;
  dispatched: number;
  /** All adoption rows for the project, whatever their state. */
  total: number;
  /** Max `last_verified_at` across the project's rows. */
  lastVerifiedAt: string | null;
}

export type FreshnessState = 'synced' | 'behind' | 'never';

/** One project tile with the DB halves merged in — what the UI renders. */
export interface TileView {
  tile: CoverageTile;
  harvest: HarvestRollup | null;
  practices: PracticeRollup | null;
  /** Merged project clock: max of the Rust filesystem clock, the harvest
   *  clock and the adoption clock — null when none carries a date. */
  projectLastAction: string | null;
  registryLastMove: string | null;
  freshness: FreshnessState;
  /** Per-dimension "carries a real signal" flags — the earning inputs. */
  presenceSignal: boolean;
  extractionSignal: boolean;
  appliedSignal: boolean;
  freshnessSignal: boolean;
  /** EARNED: zero debts AND all four dimensions carry signal AND synced. */
  inSync: boolean;
}

/** Null-safe max over ISO-8601 timestamps (compared as instants, not
 *  strings — the inputs mix git committer dates, DB timestamps and file
 *  mtimes with different offsets). Unparseable values are ignored. */
export function maxIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = v;
    }
  }
  return best;
}

/** Roll a project's harvest-coverage rows up across scopes. Empty input →
 *  `null` (no ledger rows is no signal, not a zero). */
export function rollupHarvest(rows: WorkspaceHarvestCoverage[]): HarvestRollup | null {
  if (rows.length === 0) return null;
  let lastHarvestedAt: string | null = null;
  let itemsFound = 0;
  let runCount = 0;
  let scopesHarvested = 0;
  for (const row of rows) {
    if (row.lastHarvestedAt !== null) {
      scopesHarvested += 1;
      lastHarvestedAt = maxIso(lastHarvestedAt, row.lastHarvestedAt);
      itemsFound += Number(row.itemsFound);
    }
    runCount += Number(row.runCount);
  }
  return { lastHarvestedAt, itemsFound, runCount, scopesHarvested, scopesTotal: rows.length };
}

/** Roll adoption rows up for one project. No rows for the project → `null`. */
export function rollupPractices(
  rows: WorkspacePracticeAdoption[],
  projectId: string,
): PracticeRollup | null {
  const mine = rows.filter((r) => r.project_id === projectId);
  if (mine.length === 0) return null;
  let adopted = 0;
  let diverged = 0;
  let dispatched = 0;
  let lastVerifiedAt: string | null = null;
  for (const r of mine) {
    if (r.state === 'adopted') adopted += 1;
    else if (r.state === 'diverged') diverged += 1;
    else if (r.state === 'dispatched') dispatched += 1;
    lastVerifiedAt = maxIso(lastVerifiedAt, r.last_verified_at);
  }
  return { adopted, diverged, dispatched, total: mine.length, lastVerifiedAt };
}

/** Merge one Rust tile with its DB rollups into the display view. */
export function buildTileView(
  tile: CoverageTile,
  harvest: HarvestRollup | null,
  practices: PracticeRollup | null,
): TileView {
  const projectLastAction = maxIso(
    tile.staleness.projectLastAction,
    harvest?.lastHarvestedAt,
    practices?.lastVerifiedAt,
  );
  const registryLastMove = tile.staleness.registryLastMove;

  let freshness: FreshnessState;
  if (projectLastAction === null) {
    freshness = 'never';
  } else if (
    registryLastMove !== null &&
    Date.parse(registryLastMove) > Date.parse(projectLastAction)
  ) {
    freshness = 'behind';
  } else {
    freshness = 'synced';
  }

  const presenceSignal = tile.presence.inRegistry;
  const extractionSignal =
    tile.presence.forgedFrom || (harvest !== null && harvest.scopesHarvested > 0);
  const appliedSignal =
    tile.applied.skillsAdopted > 0 ||
    (tile.applied.registryMap?.exists ?? false) ||
    (practices !== null && practices.total > 0);
  // Freshness carries signal only when BOTH clocks exist — a project clock
  // with no registry clock (or vice versa) cannot claim a comparison.
  const freshnessSignal = projectLastAction !== null && registryLastMove !== null;

  const inSync =
    tile.debts.length === 0 &&
    presenceSignal &&
    extractionSignal &&
    appliedSignal &&
    freshnessSignal &&
    freshness === 'synced';

  return {
    tile,
    harvest,
    practices,
    projectLastAction,
    registryLastMove,
    freshness,
    presenceSignal,
    extractionSignal,
    appliedSignal,
    freshnessSignal,
    inSync,
  };
}
