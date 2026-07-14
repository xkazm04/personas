import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
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
