import type { CloudDeployment } from '@/api/system/cloud';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, PauseCircle, XCircle, Circle } from 'lucide-react';
import type { Translations } from '@/i18n/generated/types';
import { interpolate } from '@/i18n/useTranslation';

/** Monthly budget caps; `undefined` is "no limit". Labels resolve at render via `budgetPresetLabel`. */
export const BUDGET_PRESETS = [undefined, 5, 10, 25, 50, 100] as const;

export function budgetPresetLabel(t: Translations, value: (typeof BUDGET_PRESETS)[number]): string {
  return value === undefined
    ? t.deployment.deployments_panel.budget_no_limit
    : interpolate(t.deployment.deployments_panel.budget_per_month, { amount: value });
}

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
