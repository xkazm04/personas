import { memo, useMemo } from 'react';
import { Loader2, ChevronRight } from 'lucide-react';
import type { DiscoveredPeer, ConnectionState } from '@/api/network/discovery';
import { TrustVerifiedIcon, TrustUnknownIcon, NodeConnectedIcon, NodeDisconnectedIcon } from './NetworkIcons';

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
  Connected: 'bg-emerald-400',
  Connecting: 'bg-amber-400 animate-pulse',
  Failed: 'bg-red-400',
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
  const state = connectionState ?? (peer.is_connected ? 'Connected' : 'Disconnected');
  const dotColor = STATE_DOT[state] ?? STATE_DOT.Disconnected;
  const isConnected = state === 'Connected';

  const truncatedId = peer.peer_id.length > 16
    ? `${peer.peer_id.slice(0, 8)}...${peer.peer_id.slice(-8)}`
    : peer.peer_id;

  const lastSeen = useMemo(() => {
    try {
      const d = new Date(peer.last_seen_at);
      const diff = Date.now() - d.getTime();
      if (diff < 60_000) return 'just now';
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
      return `${Math.floor(diff / 3_600_000)}h ago`;
    } catch {
      return '';
    }
  }, [peer.last_seen_at]);

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3 flex items-center gap-3">
      {/* Status dot */}
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />

      {/* Info */}
      <button
        onClick={() => onSelect(peer.peer_id)}
        className="min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {peer.display_name}
          </span>
          {isTrusted ? (
            <TrustVerifiedIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          ) : (
            <TrustUnknownIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs font-mono text-muted-foreground">{truncatedId}</span>
          {lastSeen && (
            <span className="text-[10px] text-muted-foreground/60">{lastSeen}</span>
          )}
        </div>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {connecting ? (
          <span className="p-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          </span>
        ) : isConnected ? (
          <button
            onClick={() => onDisconnect(peer.peer_id)}
            title="Disconnect"
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-amber-500 transition-colors"
          >
            <NodeDisconnectedIcon className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => onConnect(peer.peer_id)}
            title="Connect"
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-emerald-500 transition-colors"
          >
            <NodeConnectedIcon className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onSelect(peer.peer_id)}
          title="View details"
          className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
