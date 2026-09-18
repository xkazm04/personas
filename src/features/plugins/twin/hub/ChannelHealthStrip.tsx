/**
 * ChannelHealthStrip — the first production consumer of `useChannelActivity`.
 *
 * That hook has computed last-bridged, sent counts and a 30-day stale flag
 * since the atelier era, and nothing rendered it: the only references left in
 * the tree were its own test and a comment. So a channel that stopped working
 * stayed visually identical to one the twin replied on this morning, and the
 * operator found out by noticing silence.
 *
 * Three states, and the third is the point (`failure-not-empty-success`):
 *
 *  - **quiet**   — bridged inside the window. Says when, says nothing else.
 *  - **stale**   — bridged, but not for 30 days. Amber. Re-test or archive.
 *  - **never**   — no traffic at all in the window. NOT the same claim as
 *                  stale, and the hook is already careful about this: it omits
 *                  never-used channels from `staleByChannel` rather than
 *                  defaulting them to `true`. A channel wired five minutes ago
 *                  is not rotting.
 *
 * The strip is read-only on purpose. Marking a channel stale must not hide it:
 * the outbox below still lists it, because "this looks dead" is a prompt to
 * check, not a decision to stop using it.
 */

import { AlertTriangle, CircleDashed, CircleDot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { getDeploymentChannelMeta, paletteOf } from '../shared/channels';
import { useChannelActivity } from '../sub_channels/useChannelActivity';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';

export type ChannelHealth = 'quiet' | 'stale' | 'never';

/**
 * The one place the three states are decided. Exported so the test asserts the
 * classification itself rather than a rendered colour.
 */
export function healthOf(
  channelType: string,
  lastByChannel: Map<string, string>,
  staleByChannel: Map<string, boolean>,
): ChannelHealth {
  if (!lastByChannel.has(channelType)) return 'never';
  return staleByChannel.get(channelType) ? 'stale' : 'quiet';
}

interface Props {
  twinId: string;
  /** Already scoped to this twin by the lane that owns the fetch. */
  channels: TwinChannel[];
}

export function ChannelHealthStrip({ twinId, channels }: Props) {
  const { t } = useTranslation();
  const tc = t.twin.channels;
  const { lastByChannel, staleByChannel } = useChannelActivity(twinId);

  const active = channels.filter((c) => c.is_active);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="channel-health-strip">
      {active.map((c) => {
        const health = healthOf(c.channel_type, lastByChannel, staleByChannel);
        const meta = getDeploymentChannelMeta(c.channel_type);
        const last = lastByChannel.get(c.channel_type);
        const Icon = health === 'stale' ? AlertTriangle : health === 'never' ? CircleDashed : CircleDot;
        const tone =
          health === 'stale'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            : health === 'never'
              ? 'border-primary/15 bg-secondary/20 text-foreground'
              : `border-primary/15 bg-secondary/20 ${paletteOf(meta).text}`;
        return (
          <span
            key={c.id}
            data-testid={`channel-health-${c.channel_type}`}
            data-health={health}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive border typo-caption ${tone}`}
          >
            <Icon className={`w-3 h-3 ${health === 'stale' ? 'animate-pulse' : ''}`} aria-hidden />
            <span className="text-foreground">{c.label ?? meta.label}</span>
            {health === 'never' ? (
              <span>{tc.lastNever}</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <RelativeTime timestamp={last ?? null} format="elapsed" showTooltip={false} />
                {health === 'stale' && <span>{tc.staleTag}</span>}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default ChannelHealthStrip;
