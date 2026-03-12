import type { CronAgent } from '@/lib/bindings/CronAgent';
import { formatInterval, formatRelative } from '@/features/overview/sub_cron_agents/libs/cronHelpers';

// -- Re-export shared helpers ------------------------------------------------
export { formatInterval, formatRelative };

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

export interface SkippedExecution {
  agent: CronAgent;
  missedAt: Date;
  missedCount: number;
}

export type RecoveryPolicy = 'recover' | 'skip' | 'ask';

// -- Schedule parsing --------------------------------------------------------

export function parseScheduleEntry(agent: CronAgent): ScheduleEntry {
  const failureRate = agent.recent_executions > 0
    ? agent.recent_failures / agent.recent_executions
    : 0;

  const health: ScheduleHealth =
    !agent.trigger_enabled || !agent.persona_enabled ? 'paused' :
    agent.recent_executions === 0 ? 'idle' :
    failureRate === 0 ? 'healthy' :
    failureRate < 0.6 ? 'degraded' :
    'failing';

  const schedule = agent.cron_expression
    ? agent.cron_expression
    : agent.interval_seconds
      ? `every ${formatInterval(agent.interval_seconds)}`
      : 'no schedule';

  return {
    agent,
    nextRun: agent.next_trigger_at ? new Date(agent.next_trigger_at) : null,
    lastRun: agent.last_triggered_at ? new Date(agent.last_triggered_at) : null,
    schedule,
    health,
    failureRate,
  };
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

export interface TimeGroup {
  label: string;
  entries: ScheduleEntry[];
}

export function groupByTimeWindow(entries: ScheduleEntry[]): TimeGroup[] {
  const now = Date.now();

  const labels = [
    'Overdue',
    'Next 15 minutes',
    'Next hour',
    'Next 6 hours',
    'Next 24 hours',
    'Later',
    'Paused / Unscheduled',
  ] as const;

  const buckets = new Map<string, ScheduleEntry[]>(
    labels.map((l) => [l, []]),
  );

  for (const entry of entries) {
    if (entry.health === 'paused' || !entry.nextRun) {
      buckets.get('Paused / Unscheduled')!.push(entry);
      continue;
    }

    const diff = entry.nextRun.getTime() - now;

    if (diff < 0) buckets.get('Overdue')!.push(entry);
    else if (diff < 15 * 60_000) buckets.get('Next 15 minutes')!.push(entry);
    else if (diff < 60 * 60_000) buckets.get('Next hour')!.push(entry);
    else if (diff < 6 * 3_600_000) buckets.get('Next 6 hours')!.push(entry);
    else if (diff < 24 * 3_600_000) buckets.get('Next 24 hours')!.push(entry);
    else buckets.get('Later')!.push(entry);
  }

  return labels
    .filter((l) => buckets.get(l)!.length > 0)
    .map((label) => ({ label, entries: buckets.get(label)! }));
}

// -- Skipped execution detection ---------------------------------------------

/**
 * Detect agents whose last_triggered_at + interval has passed, meaning
 * they likely missed executions while the app was offline.
 */
export function detectSkippedExecutions(agents: CronAgent[]): SkippedExecution[] {
  const now = Date.now();
  const skipped: SkippedExecution[] = [];

  for (const agent of agents) {
    if (!agent.trigger_enabled || !agent.persona_enabled) continue;

    const intervalMs = agent.interval_seconds
      ? agent.interval_seconds * 1000
      : estimateIntervalFromCron(agent.cron_expression);

    if (!intervalMs || intervalMs <= 0) continue;

    const lastRun = agent.last_triggered_at
      ? new Date(agent.last_triggered_at).getTime()
      : null;

    if (!lastRun) continue;

    const elapsed = now - lastRun;
    if (elapsed > intervalMs * 1.5) {
      const missedCount = Math.floor(elapsed / intervalMs) - 1;
      if (missedCount > 0) {
        skipped.push({
          agent,
          missedAt: new Date(lastRun + intervalMs),
          missedCount: Math.min(missedCount, 100), // cap display
        });
      }
    }
  }

  return skipped.sort((a, b) => b.missedCount - a.missedCount);
}

/**
 * Rough estimate of interval from common cron patterns.
 * Returns ms or null if unrecognizable.
 */
function estimateIntervalFromCron(cron: string | null): number | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const min = parts[0];
  const hour = parts[1];
  const dom = parts[2];

  if (!min || !hour || !dom) return null;

  // */N * * * * -> every N minutes
  if (min.startsWith('*/') && hour === '*' && dom === '*') {
    const n = parseInt(min.slice(2), 10);
    if (!isNaN(n)) return n * 60_000;
  }

  // 0 */N * * * -> every N hours
  if (min === '0' && hour.startsWith('*/') && dom === '*') {
    const n = parseInt(hour.slice(2), 10);
    if (!isNaN(n)) return n * 3_600_000;
  }

  // 0 N * * * -> daily (specific hour)
  if (min !== '*' && hour !== '*' && dom === '*') {
    return 24 * 3_600_000;
  }

  return null;
}

// -- Cron presets -------------------------------------------------------------

export const CRON_PRESETS = [
  { label: 'Every 5 min', cron: '*/5 * * * *' },
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Every 30 min', cron: '*/30 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily midnight', cron: '0 0 * * *' },
  { label: 'Daily 9am', cron: '0 9 * * *' },
  { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly Sunday', cron: '0 0 * * 0' },
] as const;
