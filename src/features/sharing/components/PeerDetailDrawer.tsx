import { useEffect, useState } from 'react';
import {
  X, RefreshCw,
  Loader2, Package, Clock,
} from 'lucide-react';
import { TrustVerifiedIcon, TrustUnknownIcon, NodeConnectedIcon, NodeDisconnectedIcon } from './NetworkIcons';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import type { DiscoveredPeer, ConnectionState, PeerManifestEntry } from '@/api/network/discovery';

interface PeerDetailDrawerProps {
  peer: DiscoveredPeer;
  connectionState?: ConnectionState;
  isTrusted: boolean;
  onClose: () => void;
  onConnect: (peerId: string) => void;
  onDisconnect: (peerId: string) => void;
}

export function PeerDetailDrawer({
  peer,
  connectionState,
  isTrusted,
  onClose,
  onConnect,
  onDisconnect,
}: PeerDetailDrawerProps) {
  const peerManifests = usePersonaStore((s) => s.peerManifests);
  const fetchPeerManifest = usePersonaStore((s) => s.fetchPeerManifest);
  const syncPeerManifest = usePersonaStore((s) => s.syncPeerManifest);
  const addToast = useToastStore((s) => s.addToast);

  const [syncing, setSyncing] = useState(false);

  const state = connectionState ?? (peer.is_connected ? 'Connected' : 'Disconnected');
  const isConnected = state === 'Connected';
  const manifest: PeerManifestEntry[] = peerManifests[peer.peer_id] ?? [];

  useEffect(() => {
    if (isConnected) {
      fetchPeerManifest(peer.peer_id);
    }
  }, [peer.peer_id, isConnected]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncPeerManifest(peer.peer_id);
      addToast('Manifest synced', 'success');
    } catch {
      addToast('Failed to sync manifest', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const truncatedId = peer.peer_id.length > 16
    ? `${peer.peer_id.slice(0, 8)}...${peer.peer_id.slice(-8)}`
    : peer.peer_id;

  const addresses: string[] = (() => {
    try {
      return typeof peer.addresses === 'string' ? JSON.parse(peer.addresses) : peer.addresses;
    } catch {
      return [];
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-background border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground truncate">
                {peer.display_name}
              </h2>
              {isTrusted ? (
                <TrustVerifiedIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <TrustUnknownIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />
              )}
            </div>
            <div className="text-xs font-mono text-muted-foreground mt-0.5">
              {truncatedId}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Connection state */}
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              isConnected ? 'bg-emerald-500/10 text-emerald-400' :
              state === 'Connecting' ? 'bg-amber-500/10 text-amber-400' :
              state === 'Failed' ? 'bg-red-500/10 text-red-400' :
              'bg-zinc-500/10 text-zinc-400'
            }`}>
              {state}
            </span>
            {isConnected ? (
              <button
                onClick={() => onDisconnect(peer.peer_id)}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
              >
                <NodeDisconnectedIcon className="w-3.5 h-3.5" />
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => onConnect(peer.peer_id)}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-1.5"
              >
                <NodeConnectedIcon className="w-3.5 h-3.5" />
                Connect
              </button>
            )}
          </div>

          {/* Peer info */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Peer Info</h4>
            <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trust</span>
                <span className={isTrusted ? 'text-emerald-400' : 'text-muted-foreground'}>
                  {isTrusted ? 'Trusted' : 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">First seen</span>
                <span className="text-foreground/80">
                  {new Date(peer.first_seen_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last seen</span>
                <span className="text-foreground/80">
                  {new Date(peer.last_seen_at).toLocaleString()}
                </span>
              </div>
              {addresses.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Address</span>
                  <span className="text-foreground/80 font-mono text-xs">
                    {addresses[0]}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Manifest / Exposed resources */}
          {isConnected && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Shared Resources
                </h4>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  title="Sync manifest"
                  className="p-1 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {syncing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {manifest.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No shared resources. Sync the manifest to check.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {manifest.map((entry) => (
                    <ManifestEntryRow key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManifestEntryRow({ entry }: { entry: PeerManifestEntry }) {
  const parsedTags: string[] = (() => {
    try {
      return typeof entry.tags === 'string' ? JSON.parse(entry.tags) : entry.tags;
    } catch {
      return [];
    }
  })();

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-2.5 flex items-center gap-2">
      <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground truncate">{entry.display_name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/40 text-muted-foreground">
            {entry.resource_type}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground/60">{entry.access_level}</span>
          {parsedTags.length > 0 && (
            <div className="flex gap-1">
              {parsedTags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary/70">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 flex-shrink-0">
        <Clock className="w-3 h-3" />
        {new Date(entry.synced_at).toLocaleDateString()}
      </div>
    </div>
  );
}
