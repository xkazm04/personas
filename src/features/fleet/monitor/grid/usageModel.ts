// usageModel — pure arithmetic behind the Activity board's Claude usage strip.
//
// The backend hands over percentages and reset timestamps; everything the
// strip prints on top of those — the plan label, the countdown, the pace
// verdict, the meter's tone — is derived here so it can be pinned by tests
// without a live subscription. No JSX, no i18n: the strip owns the words.
//
// PACE is the one judgement call. A monthly subscription is not "how many
// tokens are left" but "will this window run dry before it resets", and the
// honest read of that is utilisation against the fraction of the window
// already elapsed. The two are on the same 0–100 scale, so the difference is
// the pace: burning ten points ahead of the clock is `fast`, ten behind is
// `slow`, in between is `steady`. This mirrors the "reset-aware pace labels"
// in Claude-Code-Usage-Monitor, which is where the idea is proven in the
// field; the threshold is theirs too.

import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';

/** Meter tone thresholds. Status colours ship with an icon + label above
 *  `warning`, never colour alone. */
export const USAGE_WARN_AT = 75;
export const USAGE_ERROR_AT = 90;

export type MeterTone = 'ok' | 'warning' | 'error';

export function meterTone(pct: number): MeterTone {
  if (pct >= USAGE_ERROR_AT) return 'error';
  if (pct >= USAGE_WARN_AT) return 'warning';
  return 'ok';
}

export interface WindowProgress {
  /** Ms until the window resets, floored at 0; `null` without a reset. */
  remainingMs: number | null;
  /** 0–1, how much of the window has elapsed; `null` without a reset. */
  elapsedFrac: number | null;
}

export function windowProgress(w: ClaudeUsageWindow, now: number): WindowProgress {
  if (w.resetsAtMs === null || w.windowMs <= 0) return { remainingMs: null, elapsedFrac: null };
  const remaining = Math.max(0, w.resetsAtMs - now);
  const elapsed = Math.min(1, Math.max(0, 1 - remaining / w.windowMs));
  return { remainingMs: remaining, elapsedFrac: elapsed };
}

export type Pace = 'fast' | 'steady' | 'slow';

/** Points of utilisation beyond the clock before a window is "fast"/"slow". */
export const PACE_BAND = 10;

/**
 * Utilisation against elapsed time. `null` when the window carries no reset
 * (an untouched window has nothing to pace) or when it is too young to judge
 * — in the first 5% of a window every read is "fast" and none of them mean it.
 */
export function pace(w: ClaudeUsageWindow, now: number): Pace | null {
  const { elapsedFrac } = windowProgress(w, now);
  if (elapsedFrac === null || elapsedFrac < 0.05) return null;
  const diff = w.utilizationPct - elapsedFrac * 100;
  if (diff > PACE_BAND) return 'fast';
  if (diff < -PACE_BAND) return 'slow';
  return 'steady';
}

export interface CountdownUnits {
  day: string;
  hour: string;
  minute: string;
  /** The whole string for "less than a minute". */
  underMinute: string;
}

/**
 * "2h 14m" / "3d 4h" / "12m" — two units at most, the largest two that are
 * non-zero, because a reset three days out does not need its minutes.
 */
export function formatCountdown(ms: number, u: CountdownUnits): string {
  if (ms < 60_000) return u.underMinute;
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}${u.day} ${hours}${u.hour}` : `${days}${u.day}`;
  if (hours > 0) return mins > 0 ? `${hours}${u.hour} ${mins}${u.minute}` : `${hours}${u.hour}`;
  return `${mins}${u.minute}`;
}

/** The display order the strip uses; unknown keys sort last, stably. */
const WINDOW_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

export function orderWindows(windows: readonly ClaudeUsageWindow[]): ClaudeUsageWindow[] {
  const rank = (k: string) => {
    const i = WINDOW_ORDER.indexOf(k);
    return i < 0 ? WINDOW_ORDER.length : i;
  };
  return [...windows].sort((a, b) => rank(a.key) - rank(b.key));
}
