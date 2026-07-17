export const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

import { formatDuration as _formatDuration } from '@/lib/utils/formatters';
export const formatDuration = (ms: number) => _formatDuration(ms, { precision: 'decimal' });

export function formatMtbf(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

import { rateToHealth, healthClasses, type HealthStatus } from '@/lib/design/statusTokens';

const HEALTH_TO_SLA_COLOR: Record<HealthStatus, string> = {
  healthy: 'emerald', warning: 'amber', critical: 'red', info: 'blue', neutral: 'blue',
};

export function slaColor(rate: number): string {
  return HEALTH_TO_SLA_COLOR[rateToHealth(rate)];
}

export type SlaMetricColor = 'emerald' | 'amber' | 'red' | 'blue' | 'violet' | 'neutral';

/** Full-card tint (bg + border + text) per token — used by `SlaCard`. */
export const SLA_CARD_COLOR_CLASSES: Record<SlaMetricColor, string> = {
  emerald: healthClasses('healthy'),
  amber: healthClasses('warning'),
  red: healthClasses('critical'),
  blue: healthClasses('info'),
  violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  // No-data / not-enough-activity state: neutral grey card, never red.
  neutral: healthClasses('neutral'),
};

/** Bare text tint per token — used by compact inline metric readouts. */
export const SLA_METRIC_TEXT_CLASSES: Record<SlaMetricColor, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-rose-400',
  blue: 'text-blue-400',
  violet: 'text-violet-400',
  // No-data / not-enough-activity state: neutral foreground, never red.
  neutral: 'text-foreground',
};
