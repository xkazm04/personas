import type { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { channelIcon, channelTint } from '@/features/shared/glyph/channels';
import { deliveryStatusConfig, channelLabels } from '../libs/messageHelpers';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';

interface ChannelDeliveryPillProps {
  delivery: PersonaMessageDelivery;
  t: ReturnType<typeof useTranslation>['t'];
}

/**
 * Channel-delivery status pill: brand icon in a status-colored ring + status
 * label + hover-exact RelativeTime, wrapped in a flex gap-2 row.
 *
 * Replaces the plain-text delivery colophon in MessageDetailModal Section III.
 * The channel brand icon (Slack/Telegram/Email/Desktop) is wrapped in a ring
 * tinted by delivery status, so success/failure is scannable at a glance — the
 * icon answers "which channel", the ring + label answer "did it land".
 */
export function ChannelDeliveryPill({ delivery, t }: ChannelDeliveryPillProps) {
  const statusCfg = deliveryStatusConfig[delivery.status] ?? deliveryStatusConfig.pending!;
  const Icon = channelIcon(delivery.channel_type);
  const tint = channelTint(delivery.channel_type);
  const channelLabel = channelLabels[delivery.channel_type] ?? delivery.channel_type;
  const statusLabel = tokenLabel(t, 'delivery', delivery.status);

  return (
    <div
      data-testid={`channel-delivery-pill-${delivery.channel_type}`}
      data-status={delivery.status}
      className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full bg-secondary/[0.06] border border-primary/10"
    >
      {/* Channel brand icon inside a status-colored ring. */}
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full ring-2 ${statusCfg.ring} ${statusCfg.bgColor}`}
        aria-hidden="true"
      >
        <Icon className="w-3.5 h-3.5" style={{ color: tint }} />
      </span>

      <span className="typo-caption font-medium text-foreground/90">
        {channelLabel}
      </span>

      <span className={`typo-caption font-semibold ${statusCfg.color}`}>
        {statusLabel}
      </span>

      {delivery.delivered_at && (
        <RelativeTime
          timestamp={delivery.delivered_at}
          className="typo-caption text-foreground tabular-nums"
        />
      )}

      {delivery.error_message && (
        <span
          className="typo-caption text-red-400/80 truncate max-w-[200px]"
          title={delivery.error_message}
        >
          {delivery.error_message}
        </span>
      )}
    </div>
  );
}
