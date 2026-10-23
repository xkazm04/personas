import type { CronAgent } from '@/lib/bindings/CronAgent';

// -- Types -------------------------------------------------------------------

export type ScheduleHealth = 'healthy' | 'degraded' | 'failing' | 'paused' | 'idle';

export interface ScheduleEntry {
  agent: CronAgent;
  health: ScheduleHealth;
}

// -- Schedule parsing --------------------------------------------------------

export function parseScheduleEntry(agent: CronAgent): ScheduleEntry {
  const failureRate = agent.recent_executions > 0
    ? Number(agent.recent_failures) / Number(agent.recent_executions)
    : 0;

  const health: ScheduleHealth =
    !agent.trigger_enabled || !agent.persona_enabled ? 'paused' :
    Number(agent.recent_executions) === 0 ? 'idle' :
    failureRate === 0 ? 'healthy' :
    failureRate < 0.6 ? 'degraded' :
    'failing';

  return { agent, health };
}

// The grouped-list helpers (sortByNextRun, groupByTimeWindow, the time-window
// ids and scheduleReasonLabel) were removed with the grouped list itself
// (2026-09-17), and with them the last readers of the entry's display fields
// (schedule label, nextRun, lastRun, failureRate); the calendar derives its own
// events in `useCronPreview`. CRON_PRESETS lives in @/lib/utils/cronPresets so
// all scheduling UIs share one source of truth.
