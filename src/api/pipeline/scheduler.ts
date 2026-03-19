import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { SchedulerStats } from "@/lib/bindings/SchedulerStats";
import type { SubscriptionHealth } from "@/lib/bindings/SubscriptionHealth";

export type { SchedulerStats } from "@/lib/bindings/SchedulerStats";
export type { SubscriptionHealth } from "@/lib/bindings/SubscriptionHealth";

export const getSchedulerStatus = () =>
  invoke<SchedulerStats>("get_scheduler_status");

export const startScheduler = () =>
  invoke<SchedulerStats>("start_scheduler");

export const stopScheduler = () =>
  invoke<SchedulerStats>("stop_scheduler");

export const getSubscriptionHealth = () =>
  invoke<SubscriptionHealth[]>("get_subscription_health");
