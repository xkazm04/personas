// Pure view helpers for the Coverage lane (registry-coverage-ui R2).
//
// The Rust reader (`dev_tools_registry_coverage`) carries every dimension:
// registry presence, the forged-from extraction signal, applied skills and the
// registry-map breakdown, and both staleness clocks. This module derives the
// display judgement on top of it.
//
// (It used to merge two app-DB halves in as well — harvest coverage for
// extraction and practice adoption for applied. Both tables were retired with
// the in-app Workspace Knowledge library; the registry is the knowledge
// authority now, so the lane reads the registry alone.)
//
// Doctrine (plan D2/D5, the adherence lesson): **absence is not signal**. A
// dimension with nothing behind it renders "no signal", never a zero that
// reads as good — and "in sync" is EARNED: it requires every dimension to
// carry a real signal AND zero derived debts. Absence of debts alone is not
// health.
import type { CoverageTile } from '@/lib/bindings/CoverageTile';

export type FreshnessState = 'synced' | 'behind' | 'never';

/** One project tile plus its derived judgement — what the UI renders. */
export interface TileView {
  tile: CoverageTile;
  /** The project clock the Rust reader derived — null when it carries no date. */
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
 *  strings — the inputs mix git committer dates and file mtimes with
 *  different offsets). Unparseable values are ignored. */
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

/** Derive the display view for one Rust tile. */
export function buildTileView(tile: CoverageTile): TileView {
  const projectLastAction = maxIso(tile.staleness.projectLastAction);
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
  const extractionSignal = tile.presence.forgedFrom;
  const appliedSignal =
    tile.applied.skillsAdopted > 0 || (tile.applied.registryMap?.exists ?? false);
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
