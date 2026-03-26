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

export function slaColor(rate: number): string {
  if (rate >= 0.99) return 'emerald';
  if (rate >= 0.95) return 'amber';
  return 'red';
}
