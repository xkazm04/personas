import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import { silentCatch } from "@/lib/silentCatch";
import type { SchedulerStats } from "@/lib/bindings/SchedulerStats";
import type { SubscriptionHealth } from "@/lib/bindings/SubscriptionHealth";
import type { BackfillResult } from "@/lib/bindings/BackfillResult";
import type { ScheduleMissedRuns } from "@/lib/bindings/ScheduleMissedRuns";

export type { SchedulerStats } from "@/lib/bindings/SchedulerStats";
export type { SubscriptionHealth } from "@/lib/bindings/SubscriptionHealth";
export type { BackfillResult } from "@/lib/bindings/BackfillResult";
export type { ScheduleMissedRuns } from "@/lib/bindings/ScheduleMissedRuns";

export const getSchedulerStatus = () =>
  invoke<SchedulerStats>("get_scheduler_status");

export const startScheduler = () =>
  invoke<SchedulerStats>("start_scheduler");

export const stopScheduler = () =>
  invoke<SchedulerStats>("stop_scheduler");

export const getSubscriptionHealth = () =>
  invoke<SubscriptionHealth[]>("get_subscription_health");

export const backfillSchedule = (
  triggerId: string,
  start: string,
  end: string,
) =>
  invoke<BackfillResult>("backfill_schedule", {
    triggerId,
    start,
    end,
  });

/**
 * Direction 1 (missed-runs visibility): list schedule triggers with scheduled
 * slots that were discarded while the app was offline.
 */
export const listScheduleMissedRuns = () =>
  invoke<ScheduleMissedRuns[]>("list_schedule_missed_runs");

/**
 * Clear a trigger's discarded-while-offline count after the user backfilled the
 * gap or dismissed the badge.
 */
export const clearScheduleMissedRuns = (triggerId: string) =>
  invoke<void>("clear_schedule_missed_runs", { triggerId });

/**
 * One trigger's outcome inside {@link backfillAllMissedRuns}.
 *
 * `error` is the reason this trigger was NOT restored - a missing window, or
 * the backend's own message - and is null on success. `cleared` says whether
 * the missed-runs badge was dropped, which only happens after slots were
 * actually enqueued, so a failed row stays on the list for the next attempt.
 */
export interface MissedRunBackfill {
  triggerId: string;
  result: BackfillResult | null;
  error: string | null;
  cleared: boolean;
}

/**
 * Restore every trigger currently on the missed-runs list in one call.
 *
 * `listScheduleMissedRuns` names the triggers and counts, `backfillSchedule`
 * fills ONE trigger's window and `clearScheduleMissedRuns` drops ONE badge -
 * but nothing joined them, so restoring a weekend of downtime was N round
 * trips the operator had to aim by hand. Missed-run semantics ask for one
 * stated policy applied to the gap, not a per-cron chore.
 *
 * The window runs from the row's `firstMissedAt` (the earliest gap the sweep
 * recorded, preserved across detections) to NOW. The backend refuses future
 * slots and caps how many it enqueues, so `now` is the honest upper bound
 * rather than `lastMissedAt`, which is only when the sweep last noticed and
 * equals the start on a single detection.
 *
 * Sequential on purpose: each backfill enqueues real executions, and firing
 * every trigger's catch-up at once is how a wake-up becomes a thundering herd.
 *
 * @param triggerIds Restrict to these triggers; omit for every listed one.
 */
export async function backfillAllMissedRuns(
  triggerIds?: readonly string[],
): Promise<MissedRunBackfill[]> {
  const rows = await listScheduleMissedRuns();
  const wanted = triggerIds ? new Set(triggerIds) : null;
  const targets = wanted ? rows.filter((r) => wanted.has(r.triggerId)) : rows;

  const out: MissedRunBackfill[] = [];
  for (const row of targets) {
    const start = row.firstMissedAt ?? row.lastMissedAt;
    if (!start) {
      // A row can carry a status_reason with no counted slots (an invalid
      // timezone, say). There is no window to fill, and clearing it would hide
      // a schedule that is still broken.
      out.push({ triggerId: row.triggerId, result: null, error: "no recorded missed window", cleared: false });
      continue;
    }
    try {
      const result = await backfillSchedule(row.triggerId, start, new Date().toISOString());
      let cleared = false;
      try {
        await clearScheduleMissedRuns(row.triggerId);
        cleared = true;
      } catch (err) {
        // The slots ARE enqueued; only the badge survives. Reporting this as a
        // failure would invite a second backfill of the same window - but it
        // still reaches an error door, because a badge that will not clear is
        // how a restored schedule keeps looking broken.
        silentCatch("backfillAllMissedRuns:clearScheduleMissedRuns")(err);
        cleared = false;
      }
      out.push({ triggerId: row.triggerId, result, error: null, cleared });
    } catch (err) {
      out.push({
        triggerId: row.triggerId,
        result: null,
        error: err instanceof Error ? err.message : String(err),
        cleared: false,
      });
    }
  }
  return out;
}
