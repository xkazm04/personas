import type { CloudDeployment } from '@/api/system/cloud';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, PauseCircle, XCircle, Circle } from 'lucide-react';

export const BUDGET_PRESETS = [
  { label: 'No limit', value: undefined },
  { label: '$5/mo', value: 5 },
  { label: '$10/mo', value: 10 },
  { label: '$25/mo', value: 25 },
  { label: '$50/mo', value: 50 },
  { label: '$100/mo', value: 100 },
] as const;

export function budgetUtilization(d: CloudDeployment): number | null {
  if (!d.maxMonthlyBudgetUsd || !d.currentMonthCostUsd) return null;
  return Math.min(100, (d.currentMonthCostUsd / d.maxMonthlyBudgetUsd) * 100);
}

export function budgetColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export { formatCost } from '@/lib/utils/formatters';

export function statusColor(status: string) {
  switch (status) {
    case 'active':
      return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
    case 'paused':
      return 'bg-amber-500/10 border-amber-500/25 text-amber-400';
    case 'failed':
      return 'bg-red-500/10 border-red-500/20 text-red-400';
    default:
      return 'bg-secondary/40 border-primary/15 text-foreground';
  }
}

// Shape cue so status isn't conveyed by color alone (WCAG 1.4.1).
export function statusIcon(status: string): LucideIcon {
  switch (status) {
    case 'active':
      return CheckCircle2;
    case 'paused':
      return PauseCircle;
    case 'failed':
      return XCircle;
    default:
      return Circle;
  }
}

// `timeAgo` hoisted to `@/lib/utils/formatters` (Wave 5 consolidation).
export { timeAgo } from '@/lib/utils/formatters';
