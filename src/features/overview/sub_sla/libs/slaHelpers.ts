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

import { rateToHealth, type HealthStatus } from '@/lib/design/statusTokens';

const HEALTH_TO_SLA_COLOR: Record<HealthStatus, string> = {
  healthy: 'emerald', warning: 'amber', critical: 'red', info: 'blue', neutral: 'blue',
};

export function slaColor(rate: number): string {
  return HEALTH_TO_SLA_COLOR[rateToHealth(rate)];
}
