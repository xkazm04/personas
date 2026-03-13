import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { ScheduleEntry } from './scheduleHelpers';

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

// -- Cron fire time generator ------------------------------------------------

/**
 * Generate fire times for a cron expression within [start, end).
 * Handles common cron patterns. Returns sorted Date array.
 */
export function generateCronFireTimes(
  cron: string,
  start: Date,
  end: Date,
  maxResults = 200,
): Date[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return [];

  const minutes = parseCronField(parts[0]!, 0, 59);
  const hours = parseCronField(parts[1]!, 0, 23);
  const daysOfMonth = parseCronField(parts[2]!, 1, 31);
  const months = parseCronField(parts[3]!, 1, 12);
  const daysOfWeek = parseCronField(parts[4]!, 0, 6);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return [];

  const results: Date[] = [];
  const cursor = new Date(start);
  cursor.setSeconds(0, 0);

  // Step minute-by-minute is too slow for month view; step by candidate minutes
  // Instead iterate day-by-day, then hour, then minute
  const dayStart = startOfDay(cursor);
  const endMs = end.getTime();

  for (let d = dayStart; d.getTime() < endMs && results.length < maxResults; d = addDays(d, 1)) {
    const month1 = d.getMonth() + 1; // 1-indexed
    if (!months.has(month1)) continue;

    const dom = d.getDate();
    const dow = d.getDay();
    if (!daysOfMonth.has(dom) || !daysOfWeek.has(dow)) continue;

    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(d);
        t.setHours(h, m, 0, 0);
        if (t.getTime() >= start.getTime() && t.getTime() < endMs) {
          results.push(t);
          if (results.length >= maxResults) return results;
        }
      }
    }
  }

  return results;
}

/**
 * Generate fire times for an interval-based schedule.
 */
export function generateIntervalFireTimes(
  intervalSeconds: number,
  anchorIso: string | null,
  start: Date,
  end: Date,
  maxResults = 200,
): Date[] {
  if (intervalSeconds <= 0) return [];
  const intervalMs = intervalSeconds * 1000;

  // Anchor from last triggered time, or start of range
  let cursor = anchorIso ? new Date(anchorIso).getTime() : start.getTime();

  // Walk forward to at least start
  if (cursor < start.getTime()) {
    const steps = Math.ceil((start.getTime() - cursor) / intervalMs);
    cursor += steps * intervalMs;
  }

  const results: Date[] = [];
  const endMs = end.getTime();
  while (cursor < endMs && results.length < maxResults) {
    results.push(new Date(cursor));
    cursor += intervalMs;
  }
  return results;
}

// -- Parse single cron field (e.g., "*/5", "1-5", "0,30", "*") ---------------

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const result = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    // Wildcard: *
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }

    // Step: */N or N-M/S
    const stepMatch = trimmed.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[4]!, 10);
      if (isNaN(step) || step <= 0) return null;
      const rangeStart = stepMatch[1] === '*' ? min : parseInt(stepMatch[2]!, 10);
      const rangeEnd = stepMatch[1] === '*' ? max : parseInt(stepMatch[3]!, 10);
      for (let i = rangeStart; i <= rangeEnd; i += step) result.add(i);
      continue;
    }

    // Range: N-M
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const rStart = parseInt(rangeMatch[1]!, 10);
      const rEnd = parseInt(rangeMatch[2]!, 10);
      for (let i = rStart; i <= rEnd; i++) result.add(i);
      continue;
    }

    // Single value
    const val = parseInt(trimmed, 10);
    if (isNaN(val)) return null;
    result.add(val);
  }

  return result.size > 0 ? result : null;
}

// -- Build calendar events from schedule entries -----------------------------

export function buildCalendarEvents(
  entries: ScheduleEntry[],
  start: Date,
  end: Date,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const now = new Date();

  for (const entry of entries) {
    const { agent } = entry;
    if (entry.health === 'paused') continue;

    let fireTimes: Date[] = [];

    if (agent.cron_expression) {
      fireTimes = generateCronFireTimes(agent.cron_expression, start, end);
    } else if (agent.interval_seconds) {
      fireTimes = generateIntervalFireTimes(
        agent.interval_seconds,
        agent.last_triggered_at,
        start,
        end,
      );
    }

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

  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
}

// -- Build week grid (hour slots per day) ------------------------------------

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
