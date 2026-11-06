/**
 * The Timetable's two time axes. Every row shares them, so a mark or a block
 * is placed by one `pos()` call and drawn with percentage coordinates: no
 * measuring, no resize listeners, no re-layout when the column changes width.
 */
import type { Window } from './types';

export const MIN_MS = 60_000;
export const HOUR_MS = 60 * MIN_MS;
export const DAY_MS = 24 * HOUR_MS;

/** How far back the "today" column reaches before the pivot. */
const PAST_SPAN_MS = 11 * HOUR_MS;
/** The night ends at this local time the morning after. */
const MORNING_HOUR = 7;
const MORNING_MIN = 30;

/** 0..1 position of `t` inside `w`, clamped. */
export function pos(t: number, w: Window): number {
  const span = w.to - w.from;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (t - w.from) / span));
}

export function inWindow(t: number, w: Window): boolean {
  return t >= w.from && t <= w.to;
}

/** The next 07:30 local that is at least two hours after `t`. */
export function nextMorning(t: number): number {
  const d = new Date(t);
  d.setHours(MORNING_HOUR, MORNING_MIN, 0, 0);
  let m = d.getTime();
  while (m <= t + 2 * HOUR_MS) m += DAY_MS;
  return m;
}

/**
 * The past and night windows. The pivot is the moment the plan was armed (or
 * now, while it is still a draft): before it sits "today, from the away log",
 * after it the night the plan fills. While armed the clock walks right of the
 * pivot, which is what makes running blocks turn and settle.
 */
export function windowsFor(nowMs: number, armedAt?: number): { past: Window; night: Window } {
  const pivot = armedAt !== undefined && armedAt <= nowMs ? armedAt : nowMs;
  return {
    past: { from: pivot - PAST_SPAN_MS, to: pivot },
    night: { from: pivot, to: Math.max(nextMorning(pivot), nowMs + HOUR_MS) },
  };
}

/** Whole local hours inside `w`, for the axis ticks (every `step` hours). */
export function hourTicks(w: Window, step = 1): Array<{ pos: number; hour: number }> {
  const out: Array<{ pos: number; hour: number }> = [];
  const d = new Date(w.from);
  d.setMinutes(0, 0, 0);
  let t = d.getTime() + HOUR_MS;
  for (; t < w.to; t += HOUR_MS) {
    const hour = new Date(t).getHours();
    if (hour % step === 0) out.push({ pos: pos(t, w), hour });
  }
  return out;
}

/** "17:10" in local time. */
export function clockLabel(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
