// Scheduled tasks the operator owns: everything in the `\Personas\` Windows Task Scheduler folder
// (today the `/curator --multi` night). Read as a list, switched one task at a time; the toggle
// returns the refreshed list so the plate never shows a state it did not just read. Empty off
// Windows. See src-tauri/src/commands/fleet/schedules.rs.

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { ScheduledTaskView } from '@/lib/bindings/ScheduledTaskView';

export const fleetScheduledTasks = () => invoke<ScheduledTaskView[]>('fleet_scheduled_tasks');

export const setFleetScheduledTaskEnabled = (name: string, enabled: boolean) =>
  invoke<ScheduledTaskView[]>('fleet_scheduled_task_set_enabled', { name, enabled });
