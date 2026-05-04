import { useEffect, useRef, useState } from 'react';
import { previewCronSchedule, cronFireTimesInRange, type CronPreview } from '@/api/pipeline/triggers';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { CalendarEvent } from './calendarHelpers';
import type { ScheduleEntry } from './scheduleHelpers';

// -- next-N-from-now preview --------------------------------------------------

export interface CronPreviewResult {
  /** Parsed fire-time Dates from the backend, in ascending order. Always UTC-anchored
   *  (Dates carry epoch ms, not zone) — render with explicit `timeZone` option. */
  runs: Date[];
  /** Backend-derived English description, e.g. "Every 5 minutes". */
  description: string;
  valid: boolean;
  error: string | null;
  loading: boolean;
}

const EMPTY: CronPreviewResult = {
  runs: [],
  description: '',
  valid: false,
  error: null,
  loading: false,
};

/**
 * Backend-derived cron preview: next `count` fire times after now, evaluated
 * in `timezone` (IANA name) or system-local when undefined.
 *
 * Single source of truth: defers to `engine/cron.rs` via the
 * `preview_cron_schedule` IPC. The frontend never re-parses cron expressions.
 *
 * Set `cron` to null/empty to clear. Debounce defaults to 300ms.
 */
export function useCronPreview(
  cron: string | null | undefined,
  timezone?: string,
  count = 5,
  debounceMs = 300,
): CronPreviewResult {
  const [result, setResult] = useState<CronPreviewResult>(EMPTY);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const trimmed = cron?.trim();
    if (!trimmed) {
      setResult(EMPTY);
      return;
    }
    const myId = ++reqIdRef.current;
    setResult((prev) => ({ ...prev, loading: true }));
    const handle = setTimeout(async () => {
      try {
        const preview: CronPreview = await previewCronSchedule(trimmed, count, timezone);
        if (myId !== reqIdRef.current) return; // stale
        setResult({
          runs: preview.next_runs.map((s) => new Date(s)),
          description: preview.description,
          valid: preview.valid,
          error: preview.error,
          loading: false,
        });
      } catch (err) {
        if (myId !== reqIdRef.current) return;
        setResult({
          ...EMPTY,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [cron, timezone, count, debounceMs]);

  return result;
}

// -- windowed fire-times for the calendar ------------------------------------

export interface CronFireTimesResult {
  runs: Date[];
  loading: boolean;
  error: string | null;
}

const EMPTY_RANGE: CronFireTimesResult = { runs: [], loading: false, error: null };

/**
 * Backend-derived cron fire times within a half-open `[start, end)` window,
 * evaluated in the supplied IANA timezone. Used by the calendar.
 *
 * Stale responses are discarded via a request id ref, so rapid window
 * navigation (clicking through weeks) never paints an older window's events.
 */
export function useCronFireTimesInRange(
  cron: string | null | undefined,
  timezone: string | undefined,
  start: Date,
  end: Date,
  max?: number,
): CronFireTimesResult {
  const [result, setResult] = useState<CronFireTimesResult>(EMPTY_RANGE);
  const reqIdRef = useRef(0);
  const startMs = start.getTime();
  const endMs = end.getTime();

  useEffect(() => {
    const trimmed = cron?.trim();
    if (!trimmed || endMs <= startMs) {
      setResult(EMPTY_RANGE);
      return;
    }
    const myId = ++reqIdRef.current;
    setResult((prev) => ({ ...prev, loading: true }));
    (async () => {
      try {
        const isos = await cronFireTimesInRange(trimmed, timezone, new Date(startMs), new Date(endMs), max);
        if (myId !== reqIdRef.current) return;
        setResult({
          runs: isos.map((s) => new Date(s)),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (myId !== reqIdRef.current) return;
        setResult({
          runs: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [cron, timezone, startMs, endMs, max]);

  return result;
}

// -- calendar event orchestration --------------------------------------------

export interface CalendarEventsResult {
  events: CalendarEvent[];
  loading: boolean;
}

/**
 * Build calendar events for an array of schedule entries, fetching cron fire
 * times via IPC for each cron-driven agent and computing interval-driven fire
 * times locally (interval triggers are zone-agnostic so client-side computation
 * cannot drift). Stale responses are discarded via a request-id ref so rapid
 * window navigation does not paint an older window's events.
 */
export function useCalendarEvents(
  entries: ScheduleEntry[],
  start: Date,
  end: Date,
): CalendarEventsResult {
  const [result, setResult] = useState<CalendarEventsResult>({ events: [], loading: false });
  const reqIdRef = useRef(0);
  const startMs = start.getTime();
  const endMs = end.getTime();

  useEffect(() => {
    if (entries.length === 0 || endMs <= startMs) {
      setResult({ events: [], loading: false });
      return;
    }
    const myId = ++reqIdRef.current;
    setResult((prev) => ({ ...prev, loading: true }));
    const startD = new Date(startMs);
    const endD = new Date(endMs);
    const now = new Date();

    (async () => {
      const fireTimesPerEntry = await Promise.all(
        entries.map(async (entry) => {
          if (entry.health === 'paused') return [] as Date[];
          const { agent } = entry;
          if (agent.cron_expression) {
            try {
              const isos = await cronFireTimesInRange(
                agent.cron_expression,
                agent.timezone ?? undefined,
                startD,
                endD,
                500,
              );
              return isos.map((s) => new Date(s));
            } catch {
              return [] as Date[];
            }
          }
          if (agent.interval_seconds) {
            return generateIntervalFireTimes(
              Number(agent.interval_seconds),
              agent.last_triggered_at,
              startD,
              endD,
            );
          }
          return [] as Date[];
        }),
      );
      if (myId !== reqIdRef.current) return;

      const events: CalendarEvent[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const fireTimes = fireTimesPerEntry[i] ?? [];
        const { agent } = entry;
        for (const time of fireTimes) {
          const isPast = time.getTime() < now.getTime();
          events.push({
            id: `${agent.trigger_id}-${time.getTime()}`,
            agentId: agent.persona_id,
            agentName: agent.persona_name,
            agentIcon: agent.persona_icon,
            agentColor: agent.persona_color,
            triggerId: agent.trigger_id,
            time,
            kind: isPast
              ? (entry.health === 'failing' ? 'past-failure' : 'past-success')
              : 'projected',
          });
        }
      }
      events.sort((a, b) => a.time.getTime() - b.time.getTime());
      setResult({ events, loading: false });
    })();
  }, [entries, startMs, endMs]);

  return result;
}

/**
 * Local interval-fire-time generator. Kept on the frontend because interval
 * triggers fire every N seconds regardless of timezone — there is no zone or
 * cron semantics for the backend to authoritatively own. Identical to the
 * (deprecated) generateIntervalFireTimes in calendarHelpers, included here so
 * the new hook does not depend on the about-to-be-removed legacy module.
 */
function generateIntervalFireTimes(
  intervalSeconds: number,
  anchorIso: string | null,
  start: Date,
  end: Date,
  maxResults = 500,
): Date[] {
  if (intervalSeconds <= 0) return [];
  const intervalMs = intervalSeconds * 1000;
  let cursor = anchorIso ? new Date(anchorIso).getTime() : start.getTime();
  if (cursor < start.getTime()) {
    const steps = Math.ceil((start.getTime() - cursor) / intervalMs);
    cursor += steps * intervalMs;
  }
  const out: Date[] = [];
  const endMs = end.getTime();
  while (cursor < endMs && out.length < maxResults) {
    out.push(new Date(cursor));
    cursor += intervalMs;
  }
  return out;
}

// Reference to silence "unused import" warnings until the migration completes.
// Kept until the `previewConflicts` migration to IPC; deleting CronAgent here
// would force every consumer to re-import.
export type { CronAgent };

// -- conflict preview --------------------------------------------------------

const CONFLICT_WINDOW_MS = 5 * 60_000;

/**
 * Count fire-time conflicts in the next 7 days between a candidate schedule
 * and a list of existing entries. A conflict is two fires from different
 * triggers that land within 5 minutes of each other.
 *
 * Backend-driven: candidate + each existing cron is resolved via
 * cron_fire_times_in_range so the count matches what the engine actually
 * fires (timezone, DST, and step semantics all honored). Interval triggers
 * are computed locally because they are zone-agnostic.
 *
 * Returns 0 while the IPC fetches are in flight to avoid flashing a stale
 * value; the loading flag lets the caller render a spinner if desired.
 */
export function useConflictPreview(
  existingEntries: ScheduleEntry[] | undefined,
  candidateCron: string | null,
  candidateIntervalSeconds: number | null,
  candidateTimezone: string | undefined,
  excludeTriggerId?: string,
): { count: number; loading: boolean } {
  const [result, setResult] = useState<{ count: number; loading: boolean }>({ count: 0, loading: false });
  const reqIdRef = useRef(0);

  // Stable serialization of the existing-entry list for dep tracking. Only
  // the schedule-shaping fields matter; ignore everything else so re-renders
  // from health updates do not churn the IPC fetches.
  const sig = (existingEntries ?? [])
    .filter((e) => e.health !== 'paused' && e.agent.trigger_id !== excludeTriggerId)
    .map((e) => `${e.agent.trigger_id}|${e.agent.cron_expression ?? ''}|${e.agent.interval_seconds ?? ''}|${e.agent.timezone ?? ''}|${e.agent.last_triggered_at ?? ''}`)
    .join('::');

  useEffect(() => {
    const trimmedCandidateCron = candidateCron?.trim() ?? '';
    if (!trimmedCandidateCron && (!candidateIntervalSeconds || candidateIntervalSeconds <= 0)) {
      setResult({ count: 0, loading: false });
      return;
    }
    if (!existingEntries || existingEntries.length === 0) {
      setResult({ count: 0, loading: false });
      return;
    }
    const myId = ++reqIdRef.current;
    setResult({ count: 0, loading: true });

    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 3_600_000);

    (async () => {
      // Candidate fire times.
      let candidateTimes: Date[] = [];
      if (trimmedCandidateCron) {
        try {
          const isos = await cronFireTimesInRange(trimmedCandidateCron, candidateTimezone, now, end, 500);
          candidateTimes = isos.map((s) => new Date(s));
        } catch {
          candidateTimes = [];
        }
      } else if (candidateIntervalSeconds && candidateIntervalSeconds > 0) {
        candidateTimes = generateIntervalFireTimes(candidateIntervalSeconds, null, now, end);
      }
      if (candidateTimes.length === 0) {
        if (myId === reqIdRef.current) setResult({ count: 0, loading: false });
        return;
      }

      // Existing fire times — fetch in parallel.
      const filtered = existingEntries.filter(
        (e) => e.health !== 'paused' && (excludeTriggerId ? e.agent.trigger_id !== excludeTriggerId : true),
      );
      const existingArrays = await Promise.all(
        filtered.map(async (entry) => {
          const a = entry.agent;
          if (a.cron_expression) {
            try {
              const isos = await cronFireTimesInRange(a.cron_expression, a.timezone ?? undefined, now, end, 500);
              return isos.map((s) => new Date(s));
            } catch {
              return [] as Date[];
            }
          }
          if (a.interval_seconds) {
            return generateIntervalFireTimes(Number(a.interval_seconds), a.last_triggered_at, now, end);
          }
          return [] as Date[];
        }),
      );
      if (myId !== reqIdRef.current) return;
      const existingTimes = existingArrays.flat().sort((a, b) => a.getTime() - b.getTime());
      if (existingTimes.length === 0) {
        setResult({ count: 0, loading: false });
        return;
      }

      let conflicts = 0;
      for (const ct of candidateTimes) {
        const ctMs = ct.getTime();
        for (const et of existingTimes) {
          if (Math.abs(ctMs - et.getTime()) <= CONFLICT_WINDOW_MS) {
            conflicts++;
            break;
          }
        }
      }
      setResult({ count: conflicts, loading: false });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sig captures the
  // shape of existingEntries; including the array directly would re-fetch on
  // unrelated re-renders.
  }, [sig, candidateCron, candidateIntervalSeconds, candidateTimezone, excludeTriggerId]);

  return result;
}
