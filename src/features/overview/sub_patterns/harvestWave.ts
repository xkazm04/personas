// Which territories the next Harvest click should dispatch.
//
// Extracted from ExtractionMenu because this — not the prompt wording — is what
// makes successive harvests ADVANCE. The old engine had no notion of "where
// have I already been", so every run re-read the cheapest ground (root configs),
// hit the dedup list, and returned less than the run before it. Selecting on
// coverage is the fix, and it is worth testing on its own.
import type { WorkspaceHarvestCoverage } from '@/lib/bindings/WorkspaceHarvestCoverage';

/** Territories dispatched per click. A repo can have a dozen scopes; spawning
 *  them all at once would put a dozen Claude sessions on one machine. The
 *  coverage ledger is what makes a bounded wave safe — the next click resumes
 *  where this one stopped instead of starting over. */
export const HARVEST_WAVE = 4;

export interface HarvestWave {
  /** Scopes to dispatch now. */
  wave: WorkspaceHarvestCoverage[];
  /** Eligible-but-not-dispatched — reported so a partial pass never reads as
   *  a complete one. */
  remaining: number;
  /** Scopes skipped because a session is already running for them. */
  running: number;
}

/**
 * Pick the next wave.
 *
 * `coverage` arrives from the backend already ordered never-harvested-first,
 * then oldest-first (see `list_harvest_coverage`), so this only has to filter
 * what is already in flight and slice. Ordering is deliberately NOT re-derived
 * here: two places computing "stalest" independently is how they drift.
 */
export function selectHarvestWave(
  coverage: readonly WorkspaceHarvestCoverage[],
  isRunning: (scopeId: string) => boolean,
  waveSize = HARVEST_WAVE,
): HarvestWave {
  const eligible = coverage.filter((c) => !isRunning(c.scopeId));
  const wave = eligible.slice(0, Math.max(0, waveSize));
  return {
    wave,
    remaining: eligible.length - wave.length,
    running: coverage.length - eligible.length,
  };
}

/**
 * Harvested-vs-total for a project, plus how DEEPLY it was read.
 *
 * `done/total` alone repeats the mistake one level up: a scope skimmed at 11%
 * and one read exhaustively both count as "harvested". `pct` is the
 * file-weighted mean read-depth across scopes that reported one, so a repo that
 * has been visited everywhere and read nowhere cannot look finished.
 *
 * `null` when there is nothing to report, so the UI stays silent instead of
 * rendering a 0/0 that reads as "nothing to harvest here".
 */
export function coverageRatio(
  rows: readonly WorkspaceHarvestCoverage[] | undefined,
): { done: number; total: number; pct: number | null } | null {
  if (!rows || rows.length === 0) return null;
  const done = rows.filter((r) => r.lastHarvestedAt !== null).length;

  // Weight by territory size: 100% of a 73-file scope is not the same evidence
  // as 11% of a 587-file one. Scopes that reported no depth are excluded from
  // the mean rather than assumed complete.
  let weighted = 0;
  let weight = 0;
  for (const r of rows) {
    if (r.estimatedPct === null) continue;
    const w = Math.max(1, Number(r.fileCount));
    weighted += Number(r.estimatedPct) * w;
    weight += w;
  }
  return { done, total: rows.length, pct: weight > 0 ? Math.round(weighted / weight) : null };
}
