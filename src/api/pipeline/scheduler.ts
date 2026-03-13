import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { SchedulerStats } from "@/lib/bindings/SchedulerStats";

export type { SchedulerStats } from "@/lib/bindings/SchedulerStats";

export const getSchedulerStatus = () =>
  invoke<SchedulerStats>("get_scheduler_status");

export const startScheduler = () =>
  invoke<SchedulerStats>("start_scheduler");

export const stopScheduler = () =>
  invoke<SchedulerStats>("stop_scheduler");
