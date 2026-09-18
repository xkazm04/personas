import type { CronAgent } from '@/lib/bindings/CronAgent';
import { formatInterval } from '@/features/overview/sub_cron_agents/libs/cronHelpers';

// -- Types -------------------------------------------------------------------

export type ScheduleHealth = 'healthy' | 'degraded' | 'failing' | 'paused' | 'idle';

export interface ScheduleEntry {
  agent: CronAgent;
  nextRun: Date | null;
  lastRun: Date | null;
  schedule: string;
  health: ScheduleHealth;
  failureRate: number;
}

// -- Schedule parsing --------------------------------------------------------

export function parseScheduleEntry(agent: CronAgent): ScheduleEntry {
  const failureRate = agent.recent_executions > 0
    ? agent.recent_failures / agent.recent_executions
    : 0;

  const health: ScheduleHealth =
    !agent.trigger_enabled || !agent.persona_enabled ? 'paused' :
    Number(agent.recent_executions) === 0 ? 'idle' :
    failureRate === 0 ? 'healthy' :
    failureRate < 0.6 ? 'degraded' :
    'failing';

  const schedule = agent.cron_expression
    ? agent.cron_expression
    : agent.interval_seconds
      ? `every ${formatInterval(Number(agent.interval_seconds))}`
      : 'no schedule';

  return {
    agent,
    nextRun: agent.next_trigger_at ? new Date(agent.next_trigger_at) : null,
    lastRun: agent.last_triggered_at ? new Date(agent.last_triggered_at) : null,
    schedule,
    health,
    failureRate: Number(failureRate),
  };
}

// The grouped-list helpers (sortByNextRun, groupByTimeWindow, the time-window
// ids and scheduleReasonLabel) were removed with the grouped list itself
// (2026-09-17); the calendar derives its own events in `useCronPreview`.
// CRON_PRESETS lives in @/lib/utils/cronPresets so all scheduling UIs share one
// source of truth.
