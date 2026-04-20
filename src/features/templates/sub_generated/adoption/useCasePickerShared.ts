/**
 * Shared helpers + types for the three UseCasePickerStep variants
 * (Grid / Split / Stack). Each variant renders the same data with the
 * same behavior contract, differing only in layout + interaction.
 *
 * Keeping the behavior here means the variants are swappable at the
 * tab-switcher level without any backend/data contract drift.
 */
import { Calendar, Clock, Zap, Settings2, Hand, type LucideIcon } from 'lucide-react';

/**
 * User's trigger choice for a single capability. The materializer in
 * MatrixAdoptionView.triggerSelectionToTrigger converts this into the
 * concrete {trigger_type, config, description} shape the persona
 * builder expects.
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

export type PresetKey = TriggerSelection['preset'] | 'manual';

export interface PresetMeta {
  key: PresetKey;
  label: string;
  icon: LucideIcon;
}

export const PRESETS: PresetMeta[] = [
  { key: 'manual', label: 'Manual', icon: Hand },
  { key: 'hourly', label: 'Hourly', icon: Clock },
  { key: 'daily', label: 'Daily', icon: Calendar },
  { key: 'weekly', label: 'Weekly', icon: Calendar },
  { key: 'event', label: 'Event', icon: Zap },
  { key: 'custom', label: 'Custom cron', icon: Settings2 },
];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * "manual" is a UI concept — internally maps to preset:"custom" with
 * empty customCron. The cron-to-schedule materializer interprets that
 * as trigger_type: "manual" and drops the cron field.
 */
export function isManual(sel: TriggerSelection | undefined): boolean {
  return sel?.preset === 'custom' && !sel.customCron?.trim();
}

export function presetKeyForSelection(sel: TriggerSelection | undefined): PresetKey {
  if (!sel) return 'manual';
  if (isManual(sel)) return 'manual';
  return sel.preset;
}

export function selectionForPreset(
  key: PresetKey,
  prev: TriggerSelection | undefined,
): TriggerSelection {
  switch (key) {
    case 'manual':
      return { preset: 'custom', customCron: '' };
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
    case 'event':
      return { preset: 'event', eventType: prev?.eventType };
    case 'custom':
      return { preset: 'custom', customCron: prev?.customCron ?? '' };
  }
}

export function clampHour(raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(23, n));
}

/**
 * One-line human-readable summary of a trigger selection, used in the
 * split-pane list and the stack's collapsed rows.
 */
export function describeSelection(sel: TriggerSelection | undefined): string {
  if (!sel) return 'Manual';
  if (isManual(sel)) return 'Manual';
  switch (sel.preset) {
    case 'hourly':
      return 'Hourly';
    case 'daily':
      return `Daily at ${String(sel.hourOfDay ?? 9).padStart(2, '0')}:00`;
    case 'weekly':
      return `${WEEKDAYS[sel.weekday ?? 1] ?? 'Mon'} at ${String(sel.hourOfDay ?? 9).padStart(2, '0')}:00`;
    case 'event':
      return sel.eventType ? `On ${sel.eventType}` : 'Event-driven (unconfigured)';
    case 'custom':
      return `Cron: ${sel.customCron ?? ''}`;
  }
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
