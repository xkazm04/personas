import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';

export type { ToolCallStep };

export function parseToolSteps(raw: ToolCallStep[] | null): ToolCallStep[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [];
}

export function durationColor(ms: number | null | undefined): string {
  if (ms == null) return 'bg-surface-2 text-ink-1 border-hair';
  if (ms < 2000) return 'bg-status-success/15 text-status-success border-status-success/20';
  if (ms < 10000) return 'bg-status-warning/15 text-status-warning border-status-warning/20';
  return 'bg-status-error/15 text-status-error border-status-error/20';
}

import { formatCost as _formatCost } from '@/lib/utils/formatters';
export const formatCost = (value: number | null | undefined) =>
  _formatCost(value, { precision: 4 });
