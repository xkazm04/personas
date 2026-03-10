import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Scheduler
// ============================================================================

export interface SchedulerStats {
  running: boolean;
  events_processed: number;
  events_delivered: number;
  events_failed: number;
  triggers_fired: number;
}

export const getSchedulerStatus = () =>
  invoke<SchedulerStats>("get_scheduler_status");

export const startScheduler = () =>
  invoke<SchedulerStats>("start_scheduler");

export const stopScheduler = () =>
<<<<<<< HEAD
  invoke<SchedulerStats>("stop_scheduler");2
=======
  invoke<SchedulerStats>("stop_scheduler");
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
