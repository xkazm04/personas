import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import {
  Clock,
  Webhook,
  Zap,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import type { Translations } from '@/i18n/en';

// Every label here is resolved through the `t` the caller already holds.
// Until 2026-09-04 this module did `const t = en` at load time, so the cron
// presets, trigger-type names and the health badge were English in all 14
// locales while their keys sat translated in every catalog -- the same rule
// as `@/lib/utils/cronPresets` (which carries ids, never labels), with only
// that side migrated. Passing `t` in also re-renders on a language switch.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cloud cron presets are UTC-labelled and separately keyed from the local
 * scheduler's list (`@/lib/utils/cronPresets`), which is why they stay here. */
export type CloudCronPresetId =
  | 'cron_every_5min'
  | 'cron_every_15min'
  | 'cron_every_hour'
  | 'cron_every_6hours'
  | 'cron_daily_midnight'
  | 'cron_daily_9am'
  | 'cron_weekdays_9am'
  | 'cron_weekly_sun';

export interface CloudCronPreset {
  readonly id: CloudCronPresetId;
  readonly cron: string;
}

export const CLOUD_CRON_PRESETS: readonly CloudCronPreset[] = [
  { id: 'cron_every_5min', cron: '*/5 * * * *' },
  { id: 'cron_every_15min', cron: '*/15 * * * *' },
  { id: 'cron_every_hour', cron: '0 * * * *' },
  { id: 'cron_every_6hours', cron: '0 */6 * * *' },
  { id: 'cron_daily_midnight', cron: '0 0 * * *' },
  { id: 'cron_daily_9am', cron: '0 9 * * *' },
  { id: 'cron_weekdays_9am', cron: '0 9 * * 1-5' },
  { id: 'cron_weekly_sun', cron: '0 0 * * 0' },
] as const;

export function cloudCronPresetLabel(t: Translations, preset: CloudCronPreset): string {
  return t.deployment[preset.id];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function triggerTypeLabel(t: Translations, type: string): string {
  switch (type) {
    case 'schedule': return t.deployment.cloud_trigger_schedule;
    case 'polling': return t.deployment.cloud_trigger_polling;
    case 'webhook': return t.deployment.cloud_trigger_webhook;
    case 'chain': return t.deployment.cloud_trigger_chain;
    case 'manual': return t.deployment.cloud_trigger_manual;
    default: return type;
  }
}

export function triggerTypeIcon(type: string) {
  switch (type) {
    case 'schedule': return <Clock className="w-3.5 h-3.5" />;
    case 'webhook': return <Webhook className="w-3.5 h-3.5" />;
    case 'chain': return <Zap className="w-3.5 h-3.5" />;
    default: return <Clock className="w-3.5 h-3.5" />;
  }
}

export function healthBadge(t: Translations, status: string | null) {
  if (!status || status === 'healthy') {
    return <StatusBadge variant="success" size="sm" className="typo-caption" icon={<CheckCircle2 className="w-2.5 h-2.5" />}>{t.deployment.cloud_healthy}</StatusBadge>;
  }
  return <StatusBadge variant="warning" size="sm" className="typo-caption" icon={<AlertTriangle className="w-2.5 h-2.5" />}>{status}</StatusBadge>;
}

// `timeAgo` hoisted to `@/lib/utils/formatters` (Wave 5 consolidation).
export { timeAgo, formatCost } from '@/lib/utils/formatters';

export function parseConfig(configStr: string | null): Record<string, unknown> {
  return parseJsonOrDefault<Record<string, unknown>>(configStr, {});
}
