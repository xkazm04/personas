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
 * list uses i18n keys (translated labels) and the curation list is
 * domain-specific. Both have legitimate reasons to diverge.
 *
 * Labels describe the cron expression's wall-clock time. The backend
 * evaluates cron in the trigger's configured timezone (default
 * system-local), so labels intentionally omit a zone suffix.
 */

export type CronPresetCategory =
  | 'frequent'
  | 'daily'
  | 'weekday'
  | 'weekly'
  | 'monthly';

export interface CronPreset {
  readonly label: string;
  readonly cron: string;
  readonly category: CronPresetCategory;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: 'Every minute', cron: '* * * * *', category: 'frequent' },
  { label: 'Every 5 min', cron: '*/5 * * * *', category: 'frequent' },
  { label: 'Every 15 min', cron: '*/15 * * * *', category: 'frequent' },
  { label: 'Every 30 min', cron: '*/30 * * * *', category: 'frequent' },
  { label: 'Every hour', cron: '0 * * * *', category: 'frequent' },
  { label: 'Every 6 hours', cron: '0 */6 * * *', category: 'frequent' },
  { label: 'Daily at midnight', cron: '0 0 * * *', category: 'daily' },
  { label: 'Daily at 9 AM', cron: '0 9 * * *', category: 'daily' },
  { label: 'Daily at 6 PM', cron: '0 18 * * *', category: 'daily' },
  { label: 'Twice daily (9 AM & 5 PM)', cron: '0 9,17 * * *', category: 'daily' },
  { label: 'Weekdays at 8 AM', cron: '0 8 * * 1-5', category: 'weekday' },
  { label: 'Weekdays at 9 AM', cron: '0 9 * * 1-5', category: 'weekday' },
  { label: 'Every Monday at 9 AM', cron: '0 9 * * 1', category: 'weekly' },
  { label: 'Every Friday at 5 PM', cron: '0 17 * * 5', category: 'weekly' },
  { label: 'Every Sunday', cron: '0 0 * * 0', category: 'weekly' },
  { label: 'Monthly on the 1st', cron: '0 0 1 * *', category: 'monthly' },
] as const;
