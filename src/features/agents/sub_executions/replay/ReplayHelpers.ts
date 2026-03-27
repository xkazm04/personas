// -- Replay Helpers ------------------------------------------------------

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

import { formatCost as _formatCost } from '@/lib/utils/formatters';
export const formatCost = (v: number) => _formatCost(v, { precision: 4 });

export const SPEED_OPTIONS = [1, 2, 4, 8] as const;
