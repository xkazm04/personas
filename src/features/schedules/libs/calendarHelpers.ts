import type { CronAgent } from '@/lib/bindings/CronAgent';

// -- Calendar types ----------------------------------------------------------

export type CalendarView = 'week' | 'month';

export interface CalendarEvent {
  id: string;
  agentId: string;
  agentName: string;
  agentIcon: string | null;
  agentColor: string | null;
  triggerId: string;
  time: Date;
  /** Whether this is a projected future fire or a past execution */
  kind: 'projected' | 'past-success' | 'past-failure';
}

export interface CalendarDay {
  date: Date;
  isToday: boolean;
  isCurrentMonth: boolean;
  events: CalendarEvent[];
}

export interface HourSlot {
  hour: number;
  events: CalendarEvent[];
}

// -- Date helpers ------------------------------------------------------------

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// -- Week range --------------------------------------------------------------

export function getWeekRange(anchor: Date): { start: Date; end: Date } {
  const day = anchor.getDay(); // 0=Sun
  const start = startOfDay(addDays(anchor, -day));
  const end = addDays(start, 7);
  return { start, end };
}

// -- Month range -------------------------------------------------------------

export function getMonthRange(anchor: Date): { start: Date; end: Date } {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const dayOfWeek = first.getDay();
  const start = addDays(first, -dayOfWeek); // pad to start of week
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const endDayOfWeek = last.getDay();
  const end = addDays(last, 6 - endDayOfWeek + 1); // pad to end of week
  return { start, end };
}

// -- Build week grid (hour slots per day) ------------------------------------
//
// Cron parsing and fire-time generation live in the Rust backend
// (engine/cron.rs). Frontend code requests fire times via the
// `cron_fire_times_in_range` IPC and the useCalendarEvents /
// useConflictPreview hooks in `useCronPreview.ts`. The previous
// client-side `parseCronField` + `generateCronFireTimes` +
// `buildCalendarEvents` + `previewConflicts` were deleted on
// 2026-05-01 because they re-implemented cron with semantics that
// drifted from the engine (e.g. accepting `*/100 * * * *` as a valid
// minute step where the engine rejects it). Architect ADR:
// 2026-05-01-schedules-tz-frontend-honor.

export function buildWeekGrid(
  anchor: Date,
  events: CalendarEvent[],
): { days: Date[]; hourSlots: Map<string, HourSlot[]> } {
  const { start } = getWeekRange(anchor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));

  const hourSlots = new Map<string, HourSlot[]>();
  for (const day of days) {
    const key = dayKey(day);
    const slots: HourSlot[] = [];
    for (let h = 0; h < 24; h++) {
      slots.push({ hour: h, events: [] });
    }
    hourSlots.set(key, slots);
  }

  for (const ev of events) {
    const key = dayKey(ev.time);
    const slots = hourSlots.get(key);
    if (slots) {
      const hour = ev.time.getHours();
      slots[hour]!.events.push(ev);
    }
  }

  return { days, hourSlots };
}

// -- Build month grid --------------------------------------------------------

export function buildMonthGrid(
  anchor: Date,
  events: CalendarEvent[],
): CalendarDay[] {
  const { start, end } = getMonthRange(anchor);
  const today = startOfDay(new Date());
  const currentMonth = anchor.getMonth();

  const days: CalendarDay[] = [];
  let cursor = new Date(start);
  while (cursor < end) {
    days.push({
      date: new Date(cursor),
      isToday: isSameDay(cursor, today),
      isCurrentMonth: cursor.getMonth() === currentMonth,
      events: [],
    });
    cursor = addDays(cursor, 1);
  }

  for (const ev of events) {
    const day = days.find((d) => isSameDay(d.date, ev.time));
    if (day) day.events.push(ev);
  }

  return days;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// -- Agent color assignment ---------------------------------------------------

const PALETTE = [
  '#3B82F6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16',
];

export function agentColor(agent: CronAgent, index: number): string {
  return agent.persona_color || PALETTE[index % PALETTE.length]!;
}

// -- Format helpers -----------------------------------------------------------

export function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

export function formatDayHeader(d: Date, view: CalendarView): string {
  if (view === 'week') {
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return d.getDate().toString();
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function weekdayShort(i: number): string {
  return WEEKDAY_SHORT[i] ?? '';
}

// -- Conflict detection -------------------------------------------------------

const CONFLICT_WINDOW_MS = 5 * 60_000; // 5 minutes

export interface ConflictGroup {
  /** All events within a 5-minute window */
  events: CalendarEvent[];
  /** Earliest event time in the group */
  windowStart: Date;
}

/**
 * Detect groups of 2+ events from *different* agents that fire within
 * the same 5-minute window. Returns a map keyed by event id for O(1) lookup.
 */
export function detectConflicts(events: CalendarEvent[]): {
  /** event id -> its conflict group */
  byEventId: Map<string, ConflictGroup>;
  /** dayKey-hour -> count of conflicting events in that cell (week view) */
  byHourCell: Map<string, number>;
  /** dayKey -> count of conflicting events on that day (month view) */
  byDayCell: Map<string, number>;
} {
  const byEventId = new Map<string, ConflictGroup>();
  const byHourCell = new Map<string, number>();
  const byDayCell = new Map<string, number>();

  if (events.length < 2) return { byEventId, byHourCell, byDayCell };

  // Sort by time (events from buildCalendarEvents are already sorted, but be safe)
  const sorted = [...events].sort((a, b) => a.time.getTime() - b.time.getTime());

  // Sweep: collect windows of events within CONFLICT_WINDOW_MS
  let windowStart = 0;
  for (let i = 0; i < sorted.length; i++) {
    // Move window start forward
    while (sorted[windowStart]!.time.getTime() + CONFLICT_WINDOW_MS <= sorted[i]!.time.getTime()) {
      windowStart++;
    }

    // Collect all events in [windowStart..i] that span multiple agents
    if (i > windowStart) {
      const windowEvents = sorted.slice(windowStart, i + 1);
      const uniqueAgents = new Set(windowEvents.map((e) => e.triggerId));
      if (uniqueAgents.size >= 2) {
        const group: ConflictGroup = {
          events: windowEvents,
          windowStart: sorted[windowStart]!.time,
        };
        for (const ev of windowEvents) {
          byEventId.set(ev.id, group);

          // Aggregate into hour cells
          const hKey = `${dayKey(ev.time)}-${ev.time.getHours()}`;
          byHourCell.set(hKey, (byHourCell.get(hKey) ?? 0) + 1);

          // Aggregate into day cells
          const dKey = dayKey(ev.time);
          byDayCell.set(dKey, (byDayCell.get(dKey) ?? 0) + 1);
        }
      }
    }
  }

  return { byEventId, byHourCell, byDayCell };
}

// `previewConflicts` was deleted on 2026-05-01 along with the client-side
// cron parser. Callers (FrequencyEditor) now use the `useConflictPreview`
// hook in `useCronPreview.ts` which fetches fire times via the
// `cron_fire_times_in_range` IPC.
