// The schedule plate's pure half: what a task line says, in Prague time.
//
// Times arrive as UTC epoch milliseconds and are always shown in Europe/Prague, whatever zone
// the machine runs in - the operator plans the night in Prague time, and a scheduled task's
// "23:00" is that. Words (weekday, month) follow the app's language; the zone does not.

import type { ScheduledTaskView } from '@/lib/bindings/ScheduledTaskView';
import type { Lamp } from './tone';

export const PRAGUE = 'Europe/Prague';
const DAY_MS = 86_400_000;

/** `Tue 23:00` within the coming week, `13 Oct 23:00` beyond it - Prague wall-clock time. */
export function pragueTime(ms: number, language: string, now: number = Date.now()): string {
  const near = Math.abs(ms - now) < 6 * DAY_MS;
  const opts: Intl.DateTimeFormatOptions = near
    ? { timeZone: PRAGUE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { timeZone: PRAGUE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
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
