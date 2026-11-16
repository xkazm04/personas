import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { DiscoveredPeer, ConnectionState } from '@/api/network/discovery';
import { TrustVerifiedIcon, TrustUnknownIcon, NodeConnectedIcon, NodeDisconnectedIcon } from './NetworkIcons';
import { useTranslation } from '@/i18n/useTranslation';
import { resolvePeerConnectionState } from './peerConnectionState';
import Button from '@/features/shared/components/buttons/Button';

interface PeerCardProps {
  peer: DiscoveredPeer;
  connectionState?: ConnectionState;
  isTrusted: boolean;
  onConnect: (peerId: string) => void;
  onDisconnect: (peerId: string) => void;
  onSelect: (peerId: string) => void;
  connecting?: boolean;
}

const STATE_DOT: Record<string, string> = {
  Connected: 'bg-status-success',
  Connecting: 'bg-status-warning animate-pulse',
  Failed: 'bg-status-error',
  Disconnected: 'bg-zinc-500',
};

export const PeerCard = memo(function PeerCard({
  peer,
  connectionState,
  isTrusted,
  onConnect,
  onDisconnect,
  onSelect,
  connecting,
}: PeerCardProps) {
  const { t } = useTranslation();
  const st = t.sharing;
  const state = resolvePeerConnectionState(peer, connectionState);
  const dotColor = STATE_DOT[state] ?? STATE_DOT.Disconnected;
  const isConnected = state === 'Connected';

  const truncatedId = peer.peer_id.length > 16
    ? `${peer.peer_id.slice(0, 8)}...${peer.peer_id.slice(-8)}`
    : peer.peer_id;

  return (
    <div className="rounded-modal border border-border bg-surface-1 p-3 flex items-center gap-3">
      {/* Status dot */}
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />

      {/* Info */}
      <PressSurface onPress={() => onSelect(peer.peer_id)} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="typo-body text-foreground truncate">
            {peer.display_name}
          </span>
          {isTrusted ? (
            <TrustVerifiedIcon className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
          ) : (
            <TrustUnknownIcon className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="typo-code text-foreground">{truncatedId}</span>
          <span className="typo-caption text-foreground">
            <RelativeTime timestamp={peer.last_seen_at} showTooltip={false} />
          </span>
        </div>
      </PressSurface>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {connecting ? (
          <span className="p-1.5">
            <LoadingSpinner size="sm" className="text-foreground" />
          </span>
        ) : isConnected ? (
          <Button
            type="button"
            onClick={() => onDisconnect(peer.peer_id)}
            tooltip={st.disconnect} aria-label={st.disconnect}
            variant="ghost"
            size="icon-sm"
          >
            <NodeDisconnectedIcon className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => onConnect(peer.peer_id)}
            tooltip={st.connect} aria-label={st.connect}
            variant="ghost"
            size="icon-sm"
          >
            <NodeConnectedIcon className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button
          type="button"
          onClick={() => onSelect(peer.peer_id)}
          tooltip={st.view_details} aria-label={st.view_details}
          variant="ghost"
          size="icon-sm"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
});
