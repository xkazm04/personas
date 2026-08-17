import type { PersonaTrigger } from '@/lib/types/types';
import { asTriggerKind, type TriggerKind } from '@/lib/utils/platform/triggerConstants';

/**
 * The kinds whose next fire time the scheduler computes from the config. For
 * these and only these, `next_trigger_at === null` means "this row can never
 * become due"; for every other kind a null is correct, because something other
 * than the clock wakes them.
 *
 * This restates the Rust predicate `TriggerKind::is_time_based`
 * (`core/src/models/trigger.rs`) — a hand-kept cross-language mirror, declared
 * as one deliberately. Two things bound the drift: the members are tethered to
 * the generated `TriggerKind` union, so a renamed or removed kind fails to
 * compile here; and the tripwire is on the side that changes — the Rust test
 * `only_schedule_and_polling_are_time_based` pins the predicate to exactly
 * these two and names this file when it fails. The fact itself cannot ride on
 * the payload: it is a property of the KIND, not of the row.
 */
const TIME_BASED_KINDS: ReadonlySet<TriggerKind> = new Set(
  ['schedule', 'polling'] satisfies readonly TriggerKind[],
);

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

export type TriggerArmState = 'disabled' | 'unschedulable' | 'sleeping' | 'armed';

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
 * Arm status for a trigger row:
 * - `disabled`      — switched off.
 * - `unschedulable` — a time-based trigger with no `next_trigger_at`. `get_due`
 *   requires `next_trigger_at IS NOT NULL`, so this row can never become due no
 *   matter how long you wait. It used to render as `armed`.
 * - `sleeping`      — on, but its active-window constraint excludes "now"; it
 *   won't fire until the window reopens.
 * - `armed`         — on, schedulable, and currently eligible to fire.
 *
 * **This reads `status`, not `enabled`** — deliberately. They are two encodings
 * of one fact, and the two dispatch predicates that decide whether a trigger
 * runs (`get_due` and `get_enabled_by_type`) both test `status`. Reading
 * `enabled` here meant the badge answered a different question from the engine:
 * on rows where the columns had drifted apart, the row said OFF while the event
 * bus still dispatched it. `enabled` remains the toggle's own optimistic value
 * and is still honoured — a row is `disabled` if EITHER says so, so a pending
 * toggle never reads as armed.
 *
 * `armed` is still a claim this function cannot fully substantiate: it cannot
 * see whether an `event_listener`'s event type is ever published, or whether
 * the owning persona is switched off. Those need backend answers and are
 * tracked as the "will this fire?" instrument gap.
 */
export function getTriggerArmState(trigger: PersonaTrigger, now: Date = new Date()): TriggerArmState {
  const statusDisabled = typeof trigger.status === 'string' && trigger.status !== 'active';
  if (statusDisabled || !trigger.enabled) return 'disabled';

  const kind = asTriggerKind(trigger.trigger_type);
  if (kind && TIME_BASED_KINDS.has(kind) && !trigger.next_trigger_at) return 'unschedulable';

  const aw = parseActiveWindow(trigger.config);
  if (aw && aw.enabled && aw.days.length > 0 && !isWithinActiveWindow(aw, now)) return 'sleeping';
  return 'armed';
}
