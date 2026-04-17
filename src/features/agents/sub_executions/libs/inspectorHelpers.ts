import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';

export type { ToolCallStep };

export function parseToolSteps(raw: ToolCallStep[] | null): ToolCallStep[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [];
}

export function durationColor(ms: number | null | undefined): string {
  if (ms == null) return 'bg-secondary/60 text-foreground border-primary/20';
  if (ms < 2000) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
  if (ms < 10000) return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
  return 'bg-red-500/15 text-red-400 border-red-500/20';
}

import { formatCost as _formatCost } from '@/lib/utils/formatters';
export const formatCost = (value: number) => _formatCost(value, { precision: 4 });

export function formatTimeGap(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)}ms`;
  if (ms < 60000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${(ms / 60000).toFixed(1)}m`;
}
