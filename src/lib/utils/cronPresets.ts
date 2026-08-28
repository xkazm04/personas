/**
 * Canonical cron preset list shared across scheduling UIs.
 *
 * Before consolidation, three feature folders maintained their own
 * preset lists with overlapping entries and different label conventions:
 *
 *   - `schedules/scheduleHelpers.ts` (9 presets)
 *   - `agents/sub_use_cases/scheduleHelpers.ts` (12 presets, with category)
 *   - `triggers/sub_triggers/TriggerScheduleConfig.tsx` (8 inline presets)
 *
 * Cloud-deployment and memory-curation presets stay separate: the cloud
 * list is separately keyed and the curation list is domain-specific. Both
 * have legitimate reasons to diverge.
 *
 * **Presets carry an `id`, never a label.** This list shipped sixteen
 * hardcoded English strings into a 14-locale app, rendered raw by the two
 * schedule pickers below, while the sibling cloud preset list next door was
 * already translated -- the same rule implemented twice with only one side
 * right. Labels now live in `schedules.cron_presets` and are resolved through
 * `cronPresetLabel(t, preset)`; both consuming routes (`events`, `schedules`)
 * load the `schedules` section, so the lookup cannot miss its chunk.
 *
 * Labels describe the cron expression's wall-clock time. The backend
 * evaluates cron in the trigger's configured timezone (default
 * system-local), so labels intentionally omit a zone suffix, and a locale is
 * free to write that time in whichever clock convention it reads in.
 */

import type { Translations } from '@/i18n/en';

export type CronPresetCategory =
  | 'frequent'
  | 'daily'
  | 'weekday'
  | 'weekly'
  | 'monthly';

/** Key into `status`-free i18n section `schedules.cron_presets`. */
export type CronPresetId = keyof Translations['schedules']['cron_presets'];

export interface CronPreset {
  readonly id: CronPresetId;
  readonly cron: string;
  readonly category: CronPresetCategory;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { id: 'every_minute', cron: '* * * * *', category: 'frequent' },
  { id: 'every_5_min', cron: '*/5 * * * *', category: 'frequent' },
  { id: 'every_15_min', cron: '*/15 * * * *', category: 'frequent' },
  { id: 'every_30_min', cron: '*/30 * * * *', category: 'frequent' },
  { id: 'hourly', cron: '0 * * * *', category: 'frequent' },
  { id: 'every_6_hours', cron: '0 */6 * * *', category: 'frequent' },
  { id: 'daily_midnight', cron: '0 0 * * *', category: 'daily' },
  { id: 'daily_9am', cron: '0 9 * * *', category: 'daily' },
  { id: 'daily_6pm', cron: '0 18 * * *', category: 'daily' },
  { id: 'twice_daily', cron: '0 9,17 * * *', category: 'daily' },
  { id: 'weekdays_8am', cron: '0 8 * * 1-5', category: 'weekday' },
  { id: 'weekdays_9am', cron: '0 9 * * 1-5', category: 'weekday' },
  { id: 'monday_9am', cron: '0 9 * * 1', category: 'weekly' },
  { id: 'friday_5pm', cron: '0 17 * * 5', category: 'weekly' },
  { id: 'sunday', cron: '0 0 * * 0', category: 'weekly' },
  { id: 'monthly_1st', cron: '0 0 1 * *', category: 'monthly' },
] as const;

/**
 * Resolve a preset's label for the active language.
 *
 * `t` is passed in rather than read from the store because both call sites are
 * components that already hold one -- which also makes them re-render on a
 * language switch, which a store read would not guarantee.
 */
export function cronPresetLabel(t: Translations, preset: CronPreset): string {
  return t.schedules.cron_presets[preset.id];
}
