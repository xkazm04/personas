/**
 * Typed IPC wrappers for the two **read-only brain diagnostics** commands —
 * the sleep-cycle journal (`companion_list_cycle_reports`) and the brain
 * health report (`companion_brain_health`).
 *
 * Both were registered in `src-tauri/src/lib.rs` with **zero frontend
 * callers**: ten completed sleep cycles and a full pipeline diagnostic sat in
 * `personas_data.db` with no surface that read them. `BrainCycleReports` and
 * `BrainHealthPanel` are those surfaces.
 *
 * Separated from the (very large) `@/api/companion` module for the same reason
 * `bridges.ts` is: these are consumed by one feature surface, not by the chat.
 *
 * ## Both pending backend signals have landed
 *
 * The two the health report used to under-state are now real fields on the
 * regenerated bindings, and `BrainHealthPanel` reads them at the two places
 * that were marked for them:
 *
 * 1. the `consolidation` stage is staleness-aware — `Degraded` once the last
 *    completed cycle is more than 72h old, `Unknown` on a timestamp it cannot
 *    parse, and the never-ran and stale conditions carry different blocking
 *    codes;
 * 2. `BrainCounters.conversationEpisodes` counts episodes that are actually
 *    conversation, applying the same machine-correlator exclusion the recency
 *    lane and the sleep cycle use — the number a cycle really consumes, beside
 *    the raw total.
 *
 * ## The narrative body IS now reachable
 *
 * `CycleSummary.reportNodeId` names the `companion_node` holding the cycle's
 * markdown narrative (`sleep_cycle/report.rs::render_report`), and
 * `companion_get_brain_item` now has a `cycle_report` arm that returns its
 * body — pass either that node id or the cycle's own `cyc_…` id, and it
 * answers with a `BrainDetail`. Wiring it into `BrainCycleReports` is the
 * remaining step; nothing here fakes it in the meantime.
 *
 * ## Not wrapped here yet: `companion_reconcile_episodes`
 *
 * The episode reconciler's command returns a `ReconcileReport`, whose ts-rs
 * binding is generated in the same pass as the fields above. A wrapper is
 * deliberately absent until that binding exists rather than being typed
 * against a hand-written copy of it, which is how a binding and its consumer
 * start to drift.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { BrainHealth } from '@/lib/bindings/BrainHealth';
import type { BrainCounters } from '@/lib/bindings/BrainCounters';
import type { BlockingCause } from '@/lib/bindings/BlockingCause';
import type { HealthStage } from '@/lib/bindings/HealthStage';
import type { StageStatus } from '@/lib/bindings/StageStatus';
import type { CycleSummary } from '@/lib/bindings/CycleSummary';
import type { CyclePhase } from '@/lib/bindings/CyclePhase';

export type {
  BrainHealth,
  BrainCounters,
  BlockingCause,
  HealthStage,
  StageStatus,
  CycleSummary,
  CyclePhase,
};

/** Cycles are listed newest-first by the backend (`ORDER BY started_at DESC`). */
export async function companionListCycleReports(limit?: number): Promise<CycleSummary[]> {
  return invoke<CycleSummary[]>('companion_list_cycle_reports', { limit: limit ?? null });
}

/**
 * The whole pipeline diagnostic. Runs on a blocking thread in the backend and
 * touches every lane, so it is given more room than the default timeout.
 */
export async function companionBrainHealth(): Promise<BrainHealth> {
  return invoke<BrainHealth>('companion_brain_health', undefined, { timeoutMs: 60_000 });
}

/**
 * The counters a cycle recorded, as read back from `CycleSummary.statsJson`.
 *
 * Deliberately a **wholly optional** mirror of `sleep_cycle/run.rs::CycleStats`:
 * that struct is serialised verbatim with no `rename_all`, so the keys are
 * snake_case, several are `skip_serializing_if`, and the contract is explicitly
 * versionless ("consumers tolerate unknown keys"). Every field here is
 * therefore `?` and every reader must treat absence as "this cycle did not
 * record it", never as zero.
 */
export interface CycleStats {
  episodes_in?: number;
  episodes_available?: number;
  chars_in?: number;
  truncated?: boolean;
  window_start?: string;
  consumed_through?: string;
  facts_applied?: number;
  facts_dropped?: number;
  facts_dropped_over_cap?: number;
  facts_dropped_forgotten?: number;
  procedurals_applied?: number;
  procedurals_dropped?: number;
  procedurals_dropped_over_cap?: number;
  unknown_tags_dropped?: number;
  staged_consumed?: number;
  staged_malformed?: number;
  supersedes_applied?: number;
  supersedes_dropped?: number;
  tags_proposed?: number;
  prune_candidates?: number;
  contradictions?: number;
  error?: string;
}

/**
 * Parse `CycleSummary.statsJson` into {@link CycleStats}.
 *
 * The invariant that makes the cast safe: the backend writes this column with
 * `serde_json::to_string(&CycleStats)` and falls back to the literal `"{}"` if
 * that ever fails, so the string is always a JSON **object** whose keys are a
 * subset of `CycleStats`'s snake_case field names. Every field is optional in
 * the TS mirror precisely because the Rust side may omit any of them, so a
 * shape mismatch degrades to "field absent" rather than to a lie. A row that
 * does not parse at all (an older or hand-edited row) yields `{}` — a cycle
 * whose counters are unreadable must still render its status and phases.
 */
export function parseCycleStats(statsJson: string): CycleStats {
  if (!statsJson) return {};
  try {
    const parsed: unknown = JSON.parse(statsJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as CycleStats;
  } catch {
    return {};
  }
}
