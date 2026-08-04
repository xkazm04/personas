/**
 * Tauri IPC wrapper for the Fleet Monitor's live stats.
 *
 * Mirrors `src-tauri/src/commands/fleet/monitor_stats.rs`. ONE call returns
 * the whole fleet's stats — the monitor polls it, so a per-session command
 * would multiply the poll by the session count.
 */

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { FleetMonitorStats } from '@/lib/bindings/FleetMonitorStats';

/** Live stats (tokens, context, subagents, memory) for every tracked session. */
export const monitorStats = () => invoke<FleetMonitorStats[]>('fleet_monitor_stats');
