import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import {
  Clock,
  Webhook,
  Zap,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type { CloudDeployment } from '@/api/system/cloud';
import { en } from '@/i18n/en';

const t = en;

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
  { label: t.deployment.cron_every_5min, cron: '*/5 * * * *' },
  { label: t.deployment.cron_every_15min, cron: '*/15 * * * *' },
  { label: t.deployment.cron_every_hour, cron: '0 * * * *' },
  { label: t.deployment.cron_every_6hours, cron: '0 */6 * * *' },
  { label: t.deployment.cron_daily_midnight, cron: '0 0 * * *' },
  { label: t.deployment.cron_daily_9am, cron: '0 9 * * *' },
  { label: t.deployment.cron_weekdays_9am, cron: '0 9 * * 1-5' },
  { label: t.deployment.cron_weekly_sun, cron: '0 0 * * 0' },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function triggerTypeLabel(type: string): string {
  switch (type) {
    case 'schedule': return t.deployment.cloud_trigger_schedule;
    case 'polling': return t.deployment.cloud_trigger_polling;
    case 'webhook': return t.deployment.cloud_trigger_webhook;
    case 'chain': return t.deployment.cloud_trigger_chain;
    case 'manual': return t.deployment.cloud_trigger_manual;
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
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded typo-caption font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle2 className="w-2.5 h-2.5" />{t.deployment.cloud_healthy}</span>;
  }
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded typo-caption font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"><AlertTriangle className="w-2.5 h-2.5" />{status}</span>;
}

import { formatRelativeTime } from '@/lib/utils/formatters';
export const timeAgo = (iso: string | null) => formatRelativeTime(iso, 'Never');

export { formatCost } from '@/lib/utils/formatters';

export function parseConfig(configStr: string | null): Record<string, unknown> {
  return parseJsonOrDefault<Record<string, unknown>>(configStr, {});
}
