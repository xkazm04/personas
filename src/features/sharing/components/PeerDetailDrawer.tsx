import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import {
  X, RefreshCw,
  Package, Clock,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { TrustVerifiedIcon, TrustUnknownIcon, NodeConnectedIcon, NodeDisconnectedIcon } from './NetworkIcons';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import type { DiscoveredPeer, ConnectionState, PeerManifestEntry } from '@/api/network/discovery';
import { useTranslation } from '@/i18n/useTranslation';

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
  const peerManifests = useSystemStore((s) => s.peerManifests);
  const fetchPeerManifest = useSystemStore((s) => s.fetchPeerManifest);
  const syncPeerManifest = useSystemStore((s) => s.syncPeerManifest);
  const addToast = useToastStore((s) => s.addToast);

  const drawerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const st = t.sharing;

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ resourceCount: number; syncedAt: string } | null>(null);

  // Listen for push-based manifest sync progress events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen<{ peerId: string; resourceCount: number; syncedAt: string }>(
      EventName.P2P_MANIFEST_SYNC_PROGRESS,
      (event) => {
        if (event.payload.peerId === peer.peer_id) {
          setSyncProgress({ resourceCount: event.payload.resourceCount, syncedAt: event.payload.syncedAt });
          // Refresh manifest data in the store
          fetchPeerManifest(peer.peer_id);
        }
      },
    ).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [peer.peer_id, fetchPeerManifest]);

  const state = connectionState ?? (peer.is_connected ? 'Connected' : 'Disconnected');
  const isConnected = state === 'Connected';
  const manifest: PeerManifestEntry[] = peerManifests[peer.peer_id] ?? [];

  useEffect(() => {
    if (isConnected) {
      fetchPeerManifest(peer.peer_id);
    }
  }, [peer.peer_id, isConnected]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus trap: keep Tab cycling within the drawer panel
  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = drawerRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  // Auto-focus the drawer panel on mount
  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

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
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="peer-drawer-title">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        onKeyDown={handleFocusTrap}
        className="relative w-full max-w-md bg-background border-l border-border shadow-elevation-3 flex flex-col animate-in slide-in-from-right duration-200 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="peer-drawer-title" className="text-base font-semibold text-foreground truncate">
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
            className="p-1.5 rounded-card hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
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
                className="px-3 py-1.5 text-xs rounded-card border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
              >
                <NodeDisconnectedIcon className="w-3.5 h-3.5" />
                {st.disconnect}
              </button>
            ) : (
              <button
                onClick={() => onConnect(peer.peer_id)}
                className="px-3 py-1.5 text-xs rounded-card bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-1.5"
              >
                <NodeConnectedIcon className="w-3.5 h-3.5" />
                {st.connect}
              </button>
            )}
          </div>

          {/* Peer info */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{st.peer_info}</h4>
            <div className="rounded-card border border-border bg-secondary/10 p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{st.trust_label}</span>
                <span className={isTrusted ? 'text-emerald-400' : 'text-muted-foreground'}>
                  {isTrusted ? st.trusted : st.unknown}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{st.first_seen}</span>
                <span className="text-foreground/80">
                  {new Date(peer.first_seen_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{st.last_seen}</span>
                <span className="text-foreground/80">
                  {new Date(peer.last_seen_at).toLocaleString()}
                </span>
              </div>
              {addresses.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{st.address}</span>
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
              {/* Sync progress bar */}
              {syncing && (
                <div className="h-0.5 rounded-full overflow-hidden bg-secondary/20">
                  <div
                    className="animate-fade-in h-full bg-gradient-to-r from-violet-500 to-blue-500"
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  {st.shared_resources}
                  {(syncProgress || manifest.length > 0) && (
                    <span className="text-[10px] font-normal text-muted-foreground/60">
                      {syncProgress?.resourceCount ?? manifest.length} synced
                      {syncProgress?.syncedAt && (
                        <> · {formatRelativeTime(syncProgress.syncedAt)}</>
                      )}
                    </span>
                  )}
                </h4>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  title={st.sync_manifest}
                  className="p-1 rounded-card hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {syncing ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {manifest.length === 0 ? (
                <div className="rounded-card border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  {st.no_shared_resources}
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
  const parsedTags: string[] = entry.tags ?? [];

  return (
    <div className="rounded-card border border-border bg-secondary/10 p-2.5 flex items-center gap-2">
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
