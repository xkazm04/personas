import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { Translations } from '@/i18n/en';
import { formatInterval, formatRelative } from '@/features/overview/sub_cron_agents/libs/cronHelpers';
import { CRON_PRESETS } from '@/lib/utils/cronPresets';

// -- Re-export shared helpers ------------------------------------------------
export { formatInterval, formatRelative };
export { CRON_PRESETS };

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

// -- Schedule pause reason (Direction 3) -------------------------------------

/**
 * Human-readable, translated label for a machine-readable schedule pause reason
 * (from `ScheduleMissedRuns.statusReason`). Explains WHY a schedule shows as
 * Paused/Unscheduled (next_trigger_at NULL) instead of leaving it a mystery.
 * Unknown reasons fall back to a generic label.
 */
export function scheduleReasonLabel(t: Translations, reason: string): string {
  switch (reason) {
    case 'invalid_timezone':
      return t.schedules.reason_invalid_timezone;
    default:
      return t.schedules.reason_unscheduled;
  }
}

// -- Sorting -----------------------------------------------------------------

/** Sort entries chronologically by next run (nulls last). */
export function sortByNextRun(entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].sort((a, b) => {
    if (!a.nextRun && !b.nextRun) return 0;
    if (!a.nextRun) return 1;
    if (!b.nextRun) return -1;
    return a.nextRun.getTime() - b.nextRun.getTime();
  });
}

// -- Time grouping -----------------------------------------------------------

/** Stable machine ids for the time-window buckets. Display labels live in
 *  en.json (`schedules.group_<id>`) and are resolved at render time — the id
 *  is what styling tables and React keys key off, never the English text. */
export type TimeGroupId =
  | 'overdue'
  | 'next_15m'
  | 'next_hour'
  | 'next_6h'
  | 'next_24h'
  | 'later'
  | 'paused';

export const TIME_GROUP_IDS: readonly TimeGroupId[] = [
  'overdue',
  'next_15m',
  'next_hour',
  'next_6h',
  'next_24h',
  'later',
  'paused',
] as const;

export interface TimeGroup {
  id: TimeGroupId;
  entries: ScheduleEntry[];
}

export function groupByTimeWindow(entries: ScheduleEntry[]): TimeGroup[] {
  const now = Date.now();

  const buckets = new Map<TimeGroupId, ScheduleEntry[]>(
    TIME_GROUP_IDS.map((id) => [id, []]),
  );

  for (const entry of entries) {
    if (entry.health === 'paused' || !entry.nextRun) {
      buckets.get('paused')!.push(entry);
      continue;
    }

    const diff = entry.nextRun.getTime() - now;

    if (diff < 0) buckets.get('overdue')!.push(entry);
    else if (diff < 15 * 60_000) buckets.get('next_15m')!.push(entry);
    else if (diff < 60 * 60_000) buckets.get('next_hour')!.push(entry);
    else if (diff < 6 * 3_600_000) buckets.get('next_6h')!.push(entry);
    else if (diff < 24 * 3_600_000) buckets.get('next_24h')!.push(entry);
    else buckets.get('later')!.push(entry);
  }

  return TIME_GROUP_IDS
    .filter((id) => buckets.get(id)!.length > 0)
    .map((id) => ({ id, entries: buckets.get(id)! }));
}

// CRON_PRESETS is re-exported above from @/lib/utils/cronPresets so all
// scheduling UIs share one source of truth. (detectSkippedExecutions and
// the SkippedExecution / RecoveryPolicy types were removed when the
// scheduler gained automatic max_backfill catch-up. ADR:
// 2026-05-01-schedules-overdue-backfill.)
