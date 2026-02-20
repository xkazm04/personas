import { invoke } from "@tauri-apps/api/core";

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
  invoke<SchedulerStats>("stop_scheduler");
