import { useEffect, useRef, useState } from 'react';
import { cronFireTimesInRange } from '@/api/pipeline/triggers';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { CalendarEvent } from './calendarHelpers';
import type { ScheduleEntry } from './scheduleHelpers';

// NOTE: the former `useCronPreview` (next-N-from-now) and `useCronFireTimesInRange`
// hooks were removed on 2026-07-14. They had no product consumers — only a unit
// test kept them alive — and `useCronPreview` called `preview_cron_schedule`
// WITHOUT a seed, so it modelled a fire minute the engine (which seeds H-token
// spread on `seed_hash(trigger.id)`) would never actually use. The live
// authoring preview goes through `previewCron` in `useScheduleActions.ts`, which
// now forwards the trigger id as the seed; the calendar goes through
// `useCalendarEvents` below, which already seeds `cron_fire_times_in_range` with
// `agent.trigger_id`. Keeping a seedless preview hook around only invited a
// future consumer to render a lie, so it's gone rather than "aligned".

// -- calendar event orchestration --------------------------------------------

export interface CalendarEventsResult {
  events: CalendarEvent[];
  loading: boolean;
}

/**
 * Build calendar events for an array of schedule entries, fetching cron fire
 * times via IPC for each cron-driven agent and computing interval-driven fire
 * times locally (interval triggers are zone-agnostic so client-side computation
 * cannot drift — provided we anchor on the same field the engine does).
 *
 * Stale responses are discarded via a request-id ref so rapid window
 * navigation does not paint an older window's events.
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
                agent.trigger_id,
              );
              return isos.map((s) => new Date(s));
            } catch {
              return [] as Date[];
            }
          }
          if (agent.interval_seconds) {
            // Anchor on `next_trigger_at` — the SAME field the engine anchors
            // interval re-schedules on (engine/scheduler.rs::compute_next_trigger_at).
            // Anchoring on `last_triggered_at` (tick wall-clock, up to ~5s late
            // and drifting after every skipped fire) painted a cadence the engine
            // never runs. `next_trigger_at` is future, so this yields only the
            // upcoming fires; past interval activity comes from real run records
            // (see the calendar's history matching), never a fabricated walk.
            return generateIntervalFireTimes(
              Number(agent.interval_seconds),
              agent.next_trigger_at,
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
 * Local interval-fire-time generator. Interval triggers fire every N seconds
 * regardless of timezone, so there is no cron/zone semantics for the backend to
 * authoritatively own — but the *phase* still has to match the engine. The
 * engine anchors interval re-schedules on the trigger's prior scheduled fire
 * (`next_trigger_at`), never on `now` or `last_triggered_at`
 * (engine/scheduler.rs::next_interval_at). We mirror that: walk forward from the
 * anchor by whole intervals and emit the fires that fall in `[start, end)`.
 *
 * `anchorIso` is the trigger's `next_trigger_at`. When null (paused /
 * unscheduled / brand-new) there is no engine-owned phase to project, so we
 * return nothing rather than invent one. Conflict-preview passes an explicit
 * `now + interval` anchor for a not-yet-saved candidate to match the engine's
 * "first fire" for a fresh interval trigger.
 */
export function generateIntervalFireTimes(
  intervalSeconds: number,
  anchorIso: string | null,
  start: Date,
  end: Date,
  maxResults = 500,
): Date[] {
  if (intervalSeconds <= 0 || !anchorIso) return [];
  const anchorMs = new Date(anchorIso).getTime();
  if (Number.isNaN(anchorMs)) return [];
  const intervalMs = intervalSeconds * 1000;
  let cursor = anchorMs;
  const startMs = start.getTime();
  if (cursor < startMs) {
    const steps = Math.ceil((startMs - cursor) / intervalMs);
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
 * are computed locally because they are zone-agnostic — anchored on the same
 * field the engine uses (`next_trigger_at`), or `now + interval` for the
 * not-yet-saved candidate (the engine's first fire for a fresh interval).
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
    .map((e) => `${e.agent.trigger_id}|${e.agent.cron_expression ?? ''}|${e.agent.interval_seconds ?? ''}|${e.agent.timezone ?? ''}|${e.agent.next_trigger_at ?? ''}`)
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
        // Fresh interval trigger: the engine's first fire is `now + interval`
        // (next_interval_at with a None anchor), and the cadence flows from there.
        const candidateAnchor = new Date(now.getTime() + candidateIntervalSeconds * 1000).toISOString();
        candidateTimes = generateIntervalFireTimes(candidateIntervalSeconds, candidateAnchor, now, end);
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
              const isos = await cronFireTimesInRange(
                a.cron_expression,
                a.timezone ?? undefined,
                now,
                end,
                500,
                a.trigger_id,
              );
              return isos.map((s) => new Date(s));
            } catch {
              return [] as Date[];
            }
          }
          if (a.interval_seconds) {
            return generateIntervalFireTimes(Number(a.interval_seconds), a.next_trigger_at, now, end);
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
  }, [sig, candidateCron, candidateIntervalSeconds, candidateTimezone, excludeTriggerId, existingEntries]);

  return result;
}
