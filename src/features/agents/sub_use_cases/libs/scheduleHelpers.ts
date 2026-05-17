import { DAYS } from '@/lib/utils/dayOfWeek';
import { CRON_PRESETS } from '@/lib/utils/cronPresets';

// -- Types --------------------------------------------------------------

export interface SuggestedTrigger {
  type: string;
  cron?: string;
  description?: string;
}

export interface ScheduleBuilderProps {
  suggestedTrigger: SuggestedTrigger;
  useCaseId: string;
  onActivate: (useCaseId: string, triggerType: string, config?: Record<string, unknown>) => void;
  isActivating: boolean;
}

export type BuilderMode = 'presets' | 'visual' | 'cron';

// -- Constants ----------------------------------------------------------

// DAYS and CRON_PRESETS are re-exported from the canonical modules in
// @/lib/utils so all scheduling UIs share one source of truth. See
// `src/lib/utils/dayOfWeek.ts` and `src/lib/utils/cronPresets.ts`.
export { DAYS };
export const SCHEDULE_PRESETS = CRON_PRESETS;

export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const TIMEZONES = [
  { label: 'Local time', value: 'local' },
  { label: 'UTC', value: 'UTC' },
  { label: 'US Eastern (ET)', value: 'America/New_York' },
  { label: 'US Central (CT)', value: 'America/Chicago' },
  { label: 'US Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'London (GMT/BST)', value: 'Europe/London' },
  { label: 'Berlin (CET)', value: 'Europe/Berlin' },
  { label: 'Tokyo (JST)', value: 'Asia/Tokyo' },
  { label: 'Sydney (AEST)', value: 'Australia/Sydney' },
] as const;

// -- Helpers ------------------------------------------------------------

export function formatRunTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isToday) return time;
  if (isTomorrow) return `Tomorrow ${time}`;
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` ${time}`;
}

export function formatHour(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

/** Build a cron expression from selected days and hour. */
export function buildCronFromVisual(selectedDays: Set<string>, hour: number, minute: number): string {
  if (selectedDays.size === 0) return `${minute} ${hour} * * *`;
  if (selectedDays.size === 7) return `${minute} ${hour} * * *`;

  const weekdays = new Set(['1', '2', '3', '4', '5']);
  const isWeekdays = selectedDays.size === 5 && [...selectedDays].every((d) => weekdays.has(d));
  if (isWeekdays) return `${minute} ${hour} * * 1-5`;

  const weekends = new Set(['0', '6']);
  const isWeekends = selectedDays.size === 2 && [...selectedDays].every((d) => weekends.has(d));
  if (isWeekends) return `${minute} ${hour} * * 0,6`;

  const sorted = [...selectedDays].sort((a, b) => Number(a) - Number(b));
  return `${minute} ${hour} * * ${sorted.join(',')}`;
}

/** Parse a cron expression into visual components (best effort). */
export function parseCronToVisual(cron: string): { days: Set<string>; hour: number; minute: number } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minPart, hourPart, , , dowPart] = parts;
  if (!minPart || !hourPart || !dowPart) return null;

  const minute = parseInt(minPart);
  const hour = parseInt(hourPart);
  if (isNaN(minute) || isNaN(hour)) return null;

  const days = new Set<string>();
  if (dowPart === '*') {
    DAYS.forEach((d) => days.add(d.key));
  } else if (dowPart === '1-5') {
    ['1', '2', '3', '4', '5'].forEach((d) => days.add(d));
  } else if (dowPart === '0,6' || dowPart === '6,0') {
    ['0', '6'].forEach((d) => days.add(d));
  } else {
    dowPart.split(',').forEach((d) => {
      const n = d.trim();
      if (!isNaN(Number(n))) days.add(n);
    });
  }

  return { days, hour, minute };
}
