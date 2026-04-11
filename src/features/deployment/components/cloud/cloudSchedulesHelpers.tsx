import { parseJsonOrDefault } from '@/lib/utils/parseJson';
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
  { label: 'Daily at midnight UTC', cron: '0 0 * * *' },
  { label: 'Daily at 9am UTC', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am UTC', cron: '0 9 * * 1-5' },
  { label: 'Weekly (Sun midnight UTC)', cron: '0 0 * * 0' },
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

import { formatRelativeTime } from '@/lib/utils/formatters';
export const timeAgo = (iso: string | null) => formatRelativeTime(iso, 'Never');

export { formatCost } from '@/lib/utils/formatters';

export function parseConfig(configStr: string | null): Record<string, unknown> {
  return parseJsonOrDefault<Record<string, unknown>>(configStr, {});
}
