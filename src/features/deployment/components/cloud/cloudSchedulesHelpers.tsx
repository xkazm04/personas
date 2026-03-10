import {
  Clock,
  Webhook,
  Zap,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type { CloudDeployment } from '@/api/system/cloud';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudSchedulesPanelProps {
  deployments: CloudDeployment[];
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CRON_PRESETS = [
  { label: 'Every 5 min', cron: '*/5 * * * *' },
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at midnight', cron: '0 0 * * *' },
  { label: 'Daily at 9am', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly (Sun midnight)', cron: '0 0 * * 0' },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function triggerTypeLabel(type: string): string {
  switch (type) {
    case 'schedule': return 'Scheduled (Cron)';
    case 'polling': return 'Polling';
    case 'webhook': return 'Webhook';
    case 'chain': return 'Chain';
    case 'manual': return 'Manual';
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

export function healthBadge(status: string | null) {
  if (!status || status === 'healthy') {
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle2 className="w-2.5 h-2.5" />Healthy</span>;
  }
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"><AlertTriangle className="w-2.5 h-2.5" />{status}</span>;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatCost(usd: number | null): string {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function parseConfig(configStr: string | null): Record<string, unknown> {
  if (!configStr) return {};
  try { return JSON.parse(configStr); }
  catch { return {}; }
}
