/**
 * Bridge between the from-scratch glyph builder's schedule picker
 * (`ComposerSchedulePickerModal`, which speaks `{frequency, days, monthDay,
 * time}`) and adoption's `TriggerSelection` model (Time family =
 * `{preset, hourOfDay, weekday}`). Lets the Adopt-Template flow reuse the
 * exact same schedule modal the builder uses while still feeding adoption's
 * `applyTriggerSelections` materializer at seed time.
 *
 * Monthly cadence has no adoption Time preset, so it rides the `customCron`
 * escape hatch (`triggerSelectionToTriggers` honours `customCron`).
 */
import type { Frequency } from '@/features/agents/shared/quickConfig/quickConfigTypes';
import {
  WEEKDAYS,
  clampHour,
  manualSelection,
  selectionForTimePreset,
  updateTime,
  type TriggerSelection,
} from '../useCasePickerShared';

export interface ComposerSchedule {
  frequency: Frequency | null;
  days: string[];
  monthDay: number;
  time: string;
}

/** `"09:30"` → `9` (hour only; adoption's cron path uses minute `0`). */
function hourFromTime(time: string): number {
  return clampHour((time ?? '').split(':')[0] ?? '0');
}

/** Map the composer schedule picker's output onto an adoption TriggerSelection,
 *  preserving the Event family already on `prev` (Time + Event coexist). */
export function composerScheduleToTriggerSelection(
  next: ComposerSchedule,
  prev: TriggerSelection | undefined,
): TriggerSelection {
  const hourOfDay = hourFromTime(next.time);

  if (next.frequency === null) {
    // Manual / one-off — drop the Time family, keep Event + customCron.
    const { time: _time, ...rest } = prev ?? {};
    return manualSelection(rest as TriggerSelection);
  }

  if (next.frequency === 'monthly') {
    // No adoption preset for monthly → cron escape hatch. Keep Event family.
    const day = Math.max(1, Math.min(31, next.monthDay || 1));
    return { ...(prev ?? {}), time: undefined, customCron: `0 ${hourOfDay} ${day} * *` };
  }

  if (next.frequency === 'weekly') {
    const weekday = Math.max(0, WEEKDAYS.indexOf((next.days[0] ?? 'mon') as typeof WEEKDAYS[number]));
    const seeded = selectionForTimePreset('weekly', prev);
    return updateTime(seeded, { hourOfDay, weekday: weekday < 0 ? 1 : weekday });
  }

  // daily
  const seeded = selectionForTimePreset('daily', prev);
  return updateTime(seeded, { hourOfDay });
}

/** Reverse map — seed the composer schedule modal from the current selection
 *  so re-opening the picker reflects what the user already chose. */
export function triggerSelectionToComposerSchedule(
  sel: TriggerSelection | undefined,
): ComposerSchedule {
  const time = sel?.time;
  const hh = (h: number | undefined) => `${String(h ?? 9).padStart(2, '0')}:00`;
  if (time) {
    if (time.preset === 'weekly') {
      return { frequency: 'weekly', days: [WEEKDAYS[time.weekday ?? 1] ?? 'mon'], monthDay: 1, time: hh(time.hourOfDay) };
    }
    if (time.preset === 'hourly') {
      // Composer has no "hourly" — closest is daily at the kept hour.
      return { frequency: 'daily', days: ['mon'], monthDay: 1, time: hh(time.hourOfDay) };
    }
    return { frequency: 'daily', days: ['mon'], monthDay: 1, time: hh(time.hourOfDay) };
  }
  // customCron monthly best-effort parse: "0 H D * *"
  if (sel?.customCron) {
    const parts = sel.customCron.split(/\s+/);
    const hour = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isNaN(hour) && !Number.isNaN(day)) {
      return { frequency: 'monthly', days: ['mon'], monthDay: day, time: hh(hour) };
    }
  }
  return { frequency: null, days: ['mon'], monthDay: 1, time: '09:00' };
}
