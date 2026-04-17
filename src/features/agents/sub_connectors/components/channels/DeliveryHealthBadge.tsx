import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getNotificationDeliveryStats } from '@/api/system/system';
import { typedListen } from '@/lib/eventRegistry';
import { EventName } from '@/lib/eventRegistry';
import type { ChannelDeliveryStats } from '@/lib/bindings/ChannelDeliveryStats';
import type { NotificationChannelType } from '@/lib/types/frontendTypes';

interface DeliveryHealthBadgeProps {
  channelTypes: NotificationChannelType[];
}

function getHealthColor(stats: ChannelDeliveryStats): string {
  if (stats.attempted === 0) return 'text-foreground';
  if (stats.consecutiveFailures >= 3) return 'text-red-400';
  if (stats.consecutiveFailures >= 1 || (stats.failed > 0 && stats.failed / stats.attempted > 0.2))
    return 'text-amber-400';
  return 'text-emerald-400';
}

function formatStats(stats: ChannelDeliveryStats, noDeliveries: string): string {
  if (stats.attempted === 0) return noDeliveries;
  const rate = stats.attempted > 0 ? ((stats.succeeded / stats.attempted) * 100).toFixed(0) : '0';
  const parts = [`${rate}% success (${stats.succeeded}/${stats.attempted})`];
  if (stats.avgLatencyMs > 0) parts.push(`avg ${stats.avgLatencyMs.toFixed(0)}ms`);
  if (stats.consecutiveFailures > 0) parts.push(`${stats.consecutiveFailures} consecutive failures`);
  return parts.join(' | ');
}

export function DeliveryHealthBadge({ channelTypes }: DeliveryHealthBadgeProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Record<string, ChannelDeliveryStats> | null>(null);

  useEffect(() => {
    getNotificationDeliveryStats()
      .then((s) => setStats({ slack: s.slack, telegram: s.telegram, email: s.email }))
      .catch(() => {});

    const unlisten = typedListen(EventName.NOTIFICATION_DELIVERY, () => {
      getNotificationDeliveryStats()
        .then((s) => setStats({ slack: s.slack, telegram: s.telegram, email: s.email }))
        .catch(() => {});
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (!stats) return null;

  const activeStats = channelTypes
    .filter((t) => stats[t] != null && stats[t]!.attempted > 0)
    .map((t) => ({ type: t, stats: stats[t]! }));

  if (activeStats.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-3 py-2 rounded-card bg-secondary/30 border border-border/40">
      <div className="flex items-center gap-1.5 typo-caption font-medium text-foreground">
        <Activity className="w-3 h-3" />
        {t.agents.connectors.ch_delivery_health}
      </div>
      {activeStats.map(({ type: chType, stats: s }) => (
        <div key={chType} className={`flex items-center gap-2 typo-caption ${getHealthColor(s)}`}>
          <span className="font-medium capitalize w-16">{chType}</span>
          <span className="text-foreground">{formatStats(s, t.agents.connectors.ch_no_deliveries)}</span>
        </div>
      ))}
    </div>
  );
}
