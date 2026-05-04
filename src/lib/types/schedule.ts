import type { CronAgent } from '@/lib/bindings/CronAgent';

/**
 * Canonical "what fires when" shape — the minimal subset of fields needed to
 * compute a trigger's next fire time. Three frontend surfaces previously
 * inlined these fields with different conventions:
 *
 *   - Trigger config form: ScheduleConfig in triggerConstants.ts
 *   - Schedules feature calendar: ScheduleEntry { agent: CronAgent, ... }
 *   - Glyph composer: Frequency enum (one-way to cron, no round-trip)
 *
 * Adding the timezone field for the schedules-tz-frontend-honor ADR exposed
 * the cost of that drift — a single field had to be added in 3+ places. This
 * type is the canonical primitive new components should consume; existing
 * persistence shapes (ScheduleConfig, CronAgent) keep their field names for
 * back-compat and provide normalizers below.
 *
 * Architect ADR: 2026-05-01-canonical-schedule-type
 */
export interface Schedule {
  /** 5-field cron expression (mutually exclusive with interval_seconds). */
  cron?: string;
  /** Interval in seconds; ignored when cron is set. */
  interval_seconds?: number;
  /** IANA zone the cron is evaluated in. Undefined = system-local fallback. */
  timezone?: string;
}

/**
 * Normalize a CronAgent (read-side DTO from list_cron_agents) into the
 * canonical Schedule shape. Translates the field rename `cron_expression`
 * → `cron` and discards the runtime metadata (next_trigger_at, health,
 * recent_executions, etc.) that isn't part of the schedule definition.
 */
export function toSchedule(agent: CronAgent): Schedule {
  return {
    cron: agent.cron_expression ?? undefined,
    interval_seconds: agent.interval_seconds == null ? undefined : Number(agent.interval_seconds),
    timezone: agent.timezone ?? undefined,
  };
}

/**
 * Build a Schedule from the Glyph composer's coarse-grained inputs:
 *
 *   - rhythm "daily": fires every day at `time` HH:MM
 *   - rhythm "weekly": fires on the listed `days` at `time`
 *   - rhythm "monthly": fires on day-of-month `monthDay` at `time`
 *   - rhythm "once": no schedule (returns empty Schedule); the caller is
 *     expected to handle one-shot fires through a different mechanism
 *
 * `time` is "HH:MM" in 24-hour format. `days` are ISO weekday names
 * (mon, tue, ..., sun) matching DAY_OPTIONS in ComposerScheduleDetailForm.
 */
export type Rhythm = 'once' | 'daily' | 'weekly' | 'monthly';

export interface FrequencyInputs {
  rhythm: Rhythm;
  /** 24-hour "HH:MM". Defaults to "09:00" when missing. */
  time: string;
  /** ISO weekday short names ("mon", "tue", ...). Used only for weekly. */
  days?: string[];
  /** Day of month 1-28. Used only for monthly. */
  monthDay?: number;
  /** IANA zone for the resulting cron. Undefined = system-local fallback. */
  timezone?: string;
}

const DOW_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export function frequencyToSchedule(inputs: FrequencyInputs): Schedule {
  const [hStr, mStr] = (inputs.time || '09:00').split(':');
  const hour = clampInt(parseInt(hStr ?? '9', 10), 0, 23);
  const minute = clampInt(parseInt(mStr ?? '0', 10), 0, 59);
  const tz = inputs.timezone;

  switch (inputs.rhythm) {
    case 'daily':
      return { cron: `${minute} ${hour} * * *`, timezone: tz };
    case 'weekly': {
      const dow = (inputs.days ?? [])
        .map((d) => DOW_MAP[d.toLowerCase()])
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b);
      const dowField = dow.length > 0 ? dow.join(',') : '1'; // default: Monday
      return { cron: `${minute} ${hour} * * ${dowField}`, timezone: tz };
    }
    case 'monthly': {
      const day = clampInt(inputs.monthDay ?? 1, 1, 28);
      return { cron: `${minute} ${hour} ${day} * *`, timezone: tz };
    }
    case 'once':
    default:
      return {};
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
