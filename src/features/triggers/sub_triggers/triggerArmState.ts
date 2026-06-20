import type { PersonaTrigger } from '@/lib/types/types';

/**
 * Client-side mirror of the Rust `ActiveWindow` (src-tauri/.../db/models/trigger.rs).
 * Kept in sync with `is_active_at` so the row can show *why* an enabled trigger
 * isn't currently armed (it's outside its active hours = "sleeping"), instead of
 * reading identically to a disabled one. (UAT P5 — F-TRIGGER-BLAST-RADIUS.)
 */
export interface TriggerActiveWindow {
  enabled: boolean;
  days: number[];
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  /** IANA timezone name; when absent the system-local zone is used (matches Rust). */
  timezone?: string;
}

export type TriggerArmState = 'disabled' | 'sleeping' | 'armed';

function parseActiveWindow(configStr: string | null | undefined): TriggerActiveWindow | null {
  if (!configStr) return null;
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(configStr) as Record<string, unknown>;
  } catch {
    return null;
  }
  const raw = cfg.active_window as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    enabled: Boolean(raw.enabled),
    days: Array.isArray(raw.days) ? (raw.days as number[]) : [],
    start_hour: typeof raw.start_hour === 'number' ? raw.start_hour : 9,
    start_minute: typeof raw.start_minute === 'number' ? raw.start_minute : 0,
    end_hour: typeof raw.end_hour === 'number' ? raw.end_hour : 18,
    end_minute: typeof raw.end_minute === 'number' ? raw.end_minute : 0,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : undefined,
  };
}

function localNow(now: Date): { weekday: number; minutes: number } {
  return { weekday: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
}

/** Weekday (0=Sun..6=Sat) + minutes-since-midnight, evaluated in `tz` (or local). */
function nowInZone(tz: string | undefined, now: Date): { weekday: number; minutes: number } {
  if (!tz) return localNow(now);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { weekday: map[wd] ?? 0, minutes: hour * 60 + minute };
  } catch {
    // Unknown IANA name → local fallback (matches Rust's resolve_tz behavior).
    return localNow(now);
  }
}

/** True when `now` falls inside the window. Mirrors Rust `ActiveWindow::is_active_at`. */
export function isWithinActiveWindow(aw: TriggerActiveWindow, now: Date): boolean {
  if (!aw.enabled || aw.days.length === 0) return true; // no constraint → always active
  const { weekday, minutes } = nowInZone(aw.timezone, now);
  if (!aw.days.includes(weekday)) return false;
  const start = aw.start_hour * 60 + aw.start_minute;
  const end = aw.end_hour * 60 + aw.end_minute;
  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // overnight window (e.g. 22:00 → 06:00)
}

/**
 * Three-state arm status for a trigger row:
 * - `disabled` — the user toggled it off.
 * - `sleeping` — enabled, but its active-window constraint excludes "now"; it
 *   won't fire until the window reopens. (Previously indistinguishable from off.)
 * - `armed`    — enabled and currently eligible to fire.
 */
export function getTriggerArmState(trigger: PersonaTrigger, now: Date = new Date()): TriggerArmState {
  if (!trigger.enabled) return 'disabled';
  const aw = parseActiveWindow(trigger.config);
  if (aw && aw.enabled && aw.days.length > 0 && !isWithinActiveWindow(aw, now)) return 'sleeping';
  return 'armed';
}
