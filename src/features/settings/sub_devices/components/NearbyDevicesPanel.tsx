/**
 * Devices on the LAN that could be linked, and the button that starts the
 * ceremony.
 *
 * Deliberately NOT the Network tab's raw peer list: no trust chips, no
 * manifest sync, no connect/disconnect controls, no detail drawer. Those are
 * diagnostics and stay behind the dev-only Network tab. What survives into the
 * production surface is the one decision an operator makes here — "link this
 * device to mine".
 */
import { Radar, RefreshCw } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusDot } from '@/features/shared/components/display/StatusDot';
import { useTranslation } from '@/i18n/useTranslation';
import type { DiscoveredPeer } from '@/api/network/discovery';

interface NearbyDevicesPanelProps {
  peers: DiscoveredPeer[];
  isBusy: (peerId: string) => boolean;
  onLink: (peer: DiscoveredPeer) => void;
  onRefresh: () => void;
}

export function NearbyDevicesPanel({ peers, isBusy, onLink, onRefresh }: NearbyDevicesPanelProps) {
  const { t } = useTranslation();
  const st = t.sharing;

  return (
    <SectionCard
      title={st.nearby_title}
      subtitle={st.nearby_hint}
      icon={<Radar className="w-4 h-4 text-cyan-400" />}
      titleClassName="text-primary"
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          data-testid="nearby-refresh"
          onClick={onRefresh}
        >
          {st.refresh}
        </Button>
      }
    >
      {peers.length === 0 ? (
        <div
          data-testid="nearby-empty"
          className="rounded-modal border border-dashed border-border p-6 text-center space-y-1"
        >
          <p className="typo-body text-foreground">{st.nearby_empty_title}</p>
          <p className="typo-caption text-foreground/90">{st.nearby_empty_hint}</p>
        </div>
      ) : (
        <ul data-testid="nearby-devices" className="space-y-2">
          {peers.map((peer) => (
            <li
              key={peer.peer_id}
              data-testid={`nearby-device-${peer.peer_id}`}
              className="rounded-modal border border-border bg-secondary/20 p-3 flex items-center gap-3"
            >
              <StatusDot
                kind="connection"
                state={peer.is_connected ? 'live' : 'paused'}
                label={peer.is_connected ? st.link_state_online : st.link_state_idle}
              />
              <div className="min-w-0 flex-1">
                <p className="typo-body font-medium text-foreground truncate">{peer.display_name}</p>
                <div className="flex items-center gap-2 typo-caption text-foreground/90">
                  <UuidLabel value={peer.peer_id} />
                  <RelativeTime timestamp={peer.last_seen_at} />
                </div>
              </div>
              <AsyncButton
                variant="primary"
                size="sm"
                isLoading={isBusy(peer.peer_id)}
                data-testid={`nearby-link-${peer.peer_id}`}
                onClick={() => onLink(peer)}
              >
                {st.link_device}
              </AsyncButton>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
