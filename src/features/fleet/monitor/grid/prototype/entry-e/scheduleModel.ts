// The schedule plate's pure half: what a task line says, in Prague time.
//
// Times arrive as UTC epoch milliseconds and are always shown in Europe/Prague, whatever zone
// the machine runs in - the operator plans the night in Prague time, and a scheduled task's
// "23:00" is that. Words (weekday, month) follow the app's language; the zone does not.

import type { ScheduledTaskView } from '@/lib/bindings/ScheduledTaskView';
import type { Lamp } from './tone';

export const PRAGUE = 'Europe/Prague';
const DAY_MS = 86_400_000;

/**
 * The Monitor's clock token (the persona line's next start, `clockText`), in
 * Prague wall-clock time: `23:00` today, `Tue 23:00` within the coming week,
 * `13 Oct 23:00` beyond it. 24-hour always; "today" is Prague's day.
 */
export function pragueTime(ms: number, language: string, now: number = Date.now()): string {
  const day = (x: number) => new Intl.DateTimeFormat('en-CA', { timeZone: PRAGUE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x));
  const time = { timeZone: PRAGUE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
  const opts: Intl.DateTimeFormatOptions = day(ms) === day(now) ? time
    : Math.abs(ms - now) < 6 * DAY_MS ? { ...time, weekday: 'short' }
      : { ...time, day: 'numeric', month: 'short' };
  try {
    return new Intl.DateTimeFormat(language, opts).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat('en', opts).format(new Date(ms));
  }
}

/** The plate's header lamp: lit while anything is scheduled, amber while a task is running. */
export function scheduleLamp(tasks: ScheduledTaskView[]): Lamp {
  if (tasks.some((t) => t.state === 'Running')) return { tone: 'warn', lit: true };
  if (tasks.some((t) => t.enabled)) return { tone: 'ok', lit: true };
  return { tone: 'off', lit: false };
}

/** One task's lamp. */
export function taskLamp(task: ScheduledTaskView): Lamp {
  if (task.state === 'Running') return { tone: 'warn', lit: true };
  return task.enabled ? { tone: 'ok', lit: true } : { tone: 'off', lit: false };
}
