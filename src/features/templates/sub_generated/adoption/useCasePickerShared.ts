/**
 * Shared helpers + types for UseCasePickerStep (Neon).
 *
 * Manual is the implicit default state (no chip, no family active).
 * Time and Event are two mutually-exclusive trigger families the user
 * can enable or disable per capability. Custom cron is intentionally
 * not exposed in the UI.
 */
import { Calendar, Clock, type LucideIcon } from 'lucide-react';

/**
 * User's trigger choice for a single capability. The materializer in
 * MatrixAdoptionView.triggerSelectionToTrigger converts this into the
 * concrete {trigger_type, config, description} shape the persona
 * builder expects.
 *
 * `preset: 'custom' + empty customCron` encodes the Manual state (no
 * schedule, no event listener).
 */
export interface TriggerSelection {
  preset: 'daily' | 'weekly' | 'hourly' | 'event' | 'custom';
  hourOfDay?: number;
  weekday?: number;
  eventType?: string;
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
  /** All events any UC emits — candidates for cross-UC event triggers. */
  availableEvents: string[];
  /** Persona-level trigger composition. Shared mode links all cards. */
  triggerComposition: 'shared' | 'per_use_case';
  triggerSelections: Record<string, TriggerSelection>;
  onToggle: (id: string) => void;
  onTriggerChange: (selections: Record<string, TriggerSelection>) => void;
  onContinue: () => void;
}

export type TimePreset = 'hourly' | 'daily' | 'weekly';

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

export type TriggerFamily = 'time' | 'event' | 'none';

/** Classify a selection into its family. Non-standard custom crons
 *  collapse to 'none' (Manual) because Custom is no longer in the UI. */
export function getFamily(sel: TriggerSelection | undefined): TriggerFamily {
  if (!sel) return 'none';
  if (sel.preset === 'event') return 'event';
  if (sel.preset === 'hourly' || sel.preset === 'daily' || sel.preset === 'weekly') return 'time';
  return 'none';
}

/** True when the card is in the Manual default state (no family active). */
export function isManual(sel: TriggerSelection | undefined): boolean {
  return getFamily(sel) === 'none';
}

/**
 * Build a TriggerSelection that activates the Time family with a
 * specific sub-preset, reusing any previously-set hour/weekday so the
 * user doesn't lose values when flipping between hourly/daily/weekly.
 */
export function selectionForTimePreset(
  key: TimePreset,
  prev: TriggerSelection | undefined,
): TriggerSelection {
  switch (key) {
    case 'hourly':
      return { preset: 'hourly' };
    case 'daily':
      return { preset: 'daily', hourOfDay: prev?.hourOfDay ?? 9 };
    case 'weekly':
      return {
        preset: 'weekly',
        hourOfDay: prev?.hourOfDay ?? 9,
        weekday: prev?.weekday ?? 1,
      };
  }
}

/** Reset to Manual — both families off. */
export function manualSelection(): TriggerSelection {
  return { preset: 'custom', customCron: '' };
}

/** Enable the Time family. Picks daily 9am as the default sub-preset
 *  if nothing usable comes from prev. */
export function enableTimeFamily(prev: TriggerSelection | undefined): TriggerSelection {
  if (prev && getFamily(prev) === 'time') return prev;
  return selectionForTimePreset('daily', prev);
}

/** Enable the Event family. Pre-fills the first available event when
 *  the user hasn't picked one yet. */
export function enableEventFamily(
  prev: TriggerSelection | undefined,
  availableEvents: string[],
): TriggerSelection {
  if (prev && getFamily(prev) === 'event') return prev;
  return { preset: 'event', eventType: prev?.eventType ?? availableEvents[0] };
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
