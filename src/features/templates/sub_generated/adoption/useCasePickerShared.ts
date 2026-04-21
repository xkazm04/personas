/**
 * Shared helpers + types for UseCasePickerStep (Neon).
 *
 * The trigger model has two *independent* families: Time and Event. A
 * capability can enable neither (Manual), one, or BOTH at the same
 * time. Choosing Time does not disable Event and vice versa. The
 * promote step materializes whichever families are populated into the
 * persona's trigger list.
 *
 *   Time  = one of { hourly | daily | weekly } with sub-state
 *           (hourOfDay, weekday) preserved across preset switches so
 *           the user can flip Daily ↔ Hourly ↔ Weekly without losing
 *           the hour or weekday they typed earlier.
 *   Event = listens for an emitted event across capabilities (any UC
 *           in the template can be the emitter, enabled or not).
 *
 * Custom cron is retained on the type as an escape hatch for templates
 * whose author wrote a cron the preset parser can't classify, but it
 * is intentionally NOT exposed in the UI.
 */
import { Calendar, Clock, type LucideIcon } from 'lucide-react';

export type TimePreset = 'hourly' | 'daily' | 'weekly';

export interface TimeTriggerSelection {
  preset: TimePreset;
  /** Hour-of-day, 0-23. Used by daily + weekly; ignored for hourly but
   *  kept on the object so switching presets preserves the value. */
  hourOfDay?: number;
  /** Weekday 0-6 (Sun..Sat). Used by weekly only; preserved across
   *  preset switches. */
  weekday?: number;
}

export interface EventTriggerSelection {
  eventType: string;
}

/**
 * User's trigger choice for a single capability. Both `time` and
 * `event` are optional and independent. Manual state = both undefined.
 */
export interface TriggerSelection {
  time?: TimeTriggerSelection;
  event?: EventTriggerSelection;
  /** Internal escape hatch when the template ships a cron the preset
   *  parser can't classify. Not exposed in the picker UI. */
  customCron?: string;
}

export interface UseCaseOption {
  id: string;
  name: string;
  description?: string;
  capability_summary?: string;
  /** Inferred from the template's suggested_trigger at load time. */
  defaultSelection?: TriggerSelection;
}

export interface UseCasePickerVariantProps {
  templateName?: string;
  templateGoal?: string | null;
  useCases: UseCaseOption[];
  selectedIds: Set<string>;
  /** Every event any UC emits across the template — regardless of
   *  enabled state. Surfaced as candidates in the event dropdown so
   *  users can wire cross-capability chains even when the emitter UC
   *  isn't enabled at adoption time. */
  availableEvents: string[];
  /** Persona-level trigger composition. Shared mode links all cards. */
  triggerComposition: 'shared' | 'per_use_case';
  triggerSelections: Record<string, TriggerSelection>;
  onToggle: (id: string) => void;
  onTriggerChange: (selections: Record<string, TriggerSelection>) => void;
  onContinue: () => void;
}

export interface TimePresetMeta {
  key: TimePreset;
  label: string;
  icon: LucideIcon;
}

/** Time-family sub-presets. Event is its own family (no sub-presets). */
export const TIME_PRESETS: TimePresetMeta[] = [
  { key: 'hourly', label: 'Hourly', icon: Clock },
  { key: 'daily', label: 'Daily', icon: Calendar },
  { key: 'weekly', label: 'Weekly', icon: Calendar },
];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** True when the Time family is enabled on this selection. */
export function hasTime(sel: TriggerSelection | undefined): boolean {
  return !!sel?.time;
}

/** True when the Event family is enabled on this selection. */
export function hasEvent(sel: TriggerSelection | undefined): boolean {
  return !!sel?.event;
}

/** True when the card is in the Manual default state (no family active). */
export function isManual(sel: TriggerSelection | undefined): boolean {
  return !hasTime(sel) && !hasEvent(sel);
}

/**
 * Build a TriggerSelection with the Time family set to a specific
 * sub-preset, reusing any previously-set hour/weekday from the same
 * selection (even across Hourly switches — so Daily 8am → Hourly →
 * Daily preserves the 8am). Other families (Event) are untouched.
 */
export function selectionForTimePreset(
  key: TimePreset,
  prev: TriggerSelection | undefined,
): TriggerSelection {
  // Pull persistent time metadata off the previous Time selection so
  // flipping between hourly/daily/weekly doesn't reset the user's
  // hour-of-day or weekday inputs.
  const prevTime = prev?.time;
  const hourOfDay = prevTime?.hourOfDay ?? 9;
  const weekday = prevTime?.weekday ?? 1;
  const nextTime: TimeTriggerSelection = (() => {
    switch (key) {
      case 'hourly':
        // Preserve hour/weekday so the user doesn't lose them on the
        // round trip Hourly → Daily.
        return { preset: 'hourly', hourOfDay, weekday };
      case 'daily':
        return { preset: 'daily', hourOfDay };
      case 'weekly':
        return { preset: 'weekly', hourOfDay, weekday };
    }
  })();
  return { ...(prev ?? {}), time: nextTime };
}

/** Reset to Manual — both families off; preserve customCron if the
 *  template author set one so we don't lose it silently. */
export function manualSelection(prev?: TriggerSelection): TriggerSelection {
  return prev?.customCron ? { customCron: prev.customCron } : {};
}

/**
 * Enable the Time family by seeding Daily 9am (while preserving any
 * existing hour/weekday from a prior Time sub-state). Does NOT touch
 * the Event sub-selection — a capability can have both.
 */
export function enableTimeFamily(prev: TriggerSelection | undefined): TriggerSelection {
  if (prev?.time) return prev;
  return selectionForTimePreset('daily', prev);
}

/** Disable the Time family while keeping Event + customCron intact. */
export function disableTimeFamily(prev: TriggerSelection | undefined): TriggerSelection {
  if (!prev) return {};
  const { time: _time, ...rest } = prev;
  return rest;
}

/**
 * Enable the Event family. Pre-fills the first available event when
 * the user hasn't picked one yet. Does NOT touch the Time family.
 */
export function enableEventFamily(
  prev: TriggerSelection | undefined,
  availableEvents: string[],
): TriggerSelection {
  if (prev?.event) return prev;
  return {
    ...(prev ?? {}),
    event: { eventType: availableEvents[0] ?? '' },
  };
}

/** Disable the Event family while keeping Time + customCron intact. */
export function disableEventFamily(prev: TriggerSelection | undefined): TriggerSelection {
  if (!prev) return {};
  const { event: _event, ...rest } = prev;
  return rest;
}

/** Patch only the Time sub-object, leaving Event untouched. */
export function updateTime(
  prev: TriggerSelection | undefined,
  patch: Partial<TimeTriggerSelection>,
): TriggerSelection {
  const base = prev?.time ?? { preset: 'daily' as TimePreset };
  return { ...(prev ?? {}), time: { ...base, ...patch } };
}

/** Patch only the Event sub-object, leaving Time untouched. */
export function updateEvent(
  prev: TriggerSelection | undefined,
  patch: Partial<EventTriggerSelection>,
): TriggerSelection {
  const base = prev?.event ?? { eventType: '' };
  return { ...(prev ?? {}), event: { ...base, ...patch } };
}

export function clampHour(raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(23, n));
}

/**
 * Build the broadcast-or-patch helper. Shared-composition templates
 * propagate every change to every UC; per-UC templates only update the
 * clicked card.
 */
export function makeTriggerUpdater(
  useCases: UseCaseOption[],
  triggerComposition: UseCasePickerVariantProps['triggerComposition'],
  triggerSelections: Record<string, TriggerSelection>,
  onTriggerChange: UseCasePickerVariantProps['onTriggerChange'],
) {
  return function updateTrigger(ucId: string, sel: TriggerSelection) {
    if (triggerComposition === 'shared') {
      const next: Record<string, TriggerSelection> = {};
      for (const uc of useCases) next[uc.id] = sel;
      onTriggerChange(next);
      return;
    }
    onTriggerChange({ ...triggerSelections, [ucId]: sel });
  };
}
