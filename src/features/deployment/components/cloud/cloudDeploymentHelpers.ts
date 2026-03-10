import type { CloudDeployment } from '@/api/system/cloud';

export const BUDGET_PRESETS = [
  { label: 'No limit', value: undefined },
  { label: '$5/mo', value: 5 },
  { label: '$10/mo', value: 10 },
  { label: '$25/mo', value: 25 },
  { label: '$50/mo', value: 50 },
  { label: '$100/mo', value: 100 },
] as const;

export function budgetUtilization(d: CloudDeployment): number | null {
  if (!d.max_monthly_budget_usd || !d.current_month_cost_usd) return null;
  return Math.min(100, (d.current_month_cost_usd / d.max_monthly_budget_usd) * 100);
}

export function budgetColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function statusColor(status: string) {
  switch (status) {
    case 'active':
      return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
    case 'paused':
      return 'bg-amber-500/10 border-amber-500/25 text-amber-400';
    case 'failed':
      return 'bg-red-500/10 border-red-500/20 text-red-400';
    default:
      return 'bg-secondary/40 border-primary/15 text-muted-foreground/80';
  }
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
