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
  const eligible = coverage.filter((c) => !isRunning(c.scope_id));
  const wave = eligible.slice(0, Math.max(0, waveSize));
  return {
    wave,
    remaining: eligible.length - wave.length,
    running: coverage.length - eligible.length,
  };
}

/** Harvested-vs-total for a project. `null` when there is nothing to report,
 *  so the UI can stay silent instead of rendering a 0/0 that reads as
 *  "nothing to harvest here". */
export function coverageRatio(
  rows: readonly WorkspaceHarvestCoverage[] | undefined,
): { done: number; total: number } | null {
  if (!rows || rows.length === 0) return null;
  return {
    done: rows.filter((r) => r.last_harvested_at !== null).length,
    total: rows.length,
  };
}
