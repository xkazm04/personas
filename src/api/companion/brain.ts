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
 * ## Pending backend (not invented here)
 *
 * Two signals the health report is known to under-state today, and which a
 * follow-up Rust change will correct **inside `brain/health.rs`**:
 *
 * 1. the `consolidation` stage reports `Ok` from the mere existence of a last
 *    cycle, with no staleness judgement;
 * 2. `BrainCounters.episodes` counts every episode kind, not conversation
 *    episodes alone — the number the cycle actually consumes.
 *
 * Neither field exists in `BrainHealth` / `BrainCounters` yet, so nothing here
 * reads or fakes one. When they land, they arrive as ordinary regenerated
 * binding fields and `BrainHealthPanel`'s stage/counter tables pick them up at
 * the two marked places in that file.
 *
 * ## The narrative body is NOT reachable from TypeScript
 *
 * `CycleSummary.reportNodeId` names the `companion_node` holding the cycle's
 * markdown narrative (`sleep_cycle/report.rs::render_report`), but no
 * registered command returns that node's body: `companion_get_brain_item`
 * dispatches on a closed set of kinds and has no `cycle_report` arm
 * (`commands/companion/brain.rs:184-194`). So this surface renders the
 * cycle's **structured** truth — phases, window, and every counter the cycle
 * recorded — and the prose stays unread until a backend reader exists.
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
