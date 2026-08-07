import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Users, RefreshCw, Wifi, AlertTriangle } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { PeerCard } from './PeerCard';
import { PeerDetailDrawer } from './PeerDetailDrawer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';


const logger = createLogger("peer-list");

export function PeerList() {
  const discoveredPeers = useSystemStore((s) => s.discoveredPeers);
  const connectionStates = useSystemStore((s) => s.connectionStates);
  const trustedPeers = useSystemStore((s) => s.trustedPeers);
  const networkError = useSystemStore((s) => s.networkError);
  const fetchNetworkSnapshot = useSystemStore((s) => s.fetchNetworkSnapshot);
  const connectToPeer = useSystemStore((s) => s.connectToPeer);
  const disconnectPeer = useSystemStore((s) => s.disconnectPeer);
  const addToast = useToastStore((s) => s.addToast);

  const [loading, setLoading] = useState(true);
  const [connectingPeers, setConnectingPeers] = useState<Set<string>>(new Set());
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null);
  const { t } = useTranslation();
  const st = t.sharing;

  const trustedPeerIds = useMemo(() => new Set(trustedPeers.map((p) => p.peer_id)), [trustedPeers]);

  const doFetch = useCallback(async () => {
    try {
      await fetchNetworkSnapshot();
      setLastScannedAt(Date.now());
    } catch (err) { silentCatch("features/settings/sub_network/components/PeerList:catch1")(err); }
  }, [fetchNetworkSnapshot]);

  // No interval here — NetworkDashboard drives the shared 5s snapshot poll.
  // PeerList just does a one-time initial fetch and supports manual refresh.
  useEffect(() => {
    doFetch().finally(() => setLoading(false));
  }, [doFetch]);

  const handleConnect = async (peerId: string) => {
    setConnectingPeers((prev) => new Set(prev).add(peerId));
    try {
      await connectToPeer(peerId);
      addToast(st.peer_connected_toast, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to connect to peer', { peerId, error: msg });
      addToast(st.peer_connect_failed_toast, 'error');
    } finally {
      setConnectingPeers((prev) => {
        const next = new Set(prev);
        next.delete(peerId);
        return next;
      });
    }
  };

  const handleDisconnect = async (peerId: string) => {
    try {
      await disconnectPeer(peerId);
      addToast(st.peer_disconnected_toast, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to disconnect', { peerId, error: msg });
      addToast(st.peer_disconnect_failed_toast, 'error');
    }
  };

  const selectedPeer = discoveredPeers.find((p) => p.peer_id === selectedPeerId) ?? null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="typo-heading font-semibold text-foreground flex items-center gap-2">
          <Users className="w-4 h-4" />
          {st.discovered_peers}
        </h3>
        <div className="flex flex-col items-end gap-0.5">
          <button
            type="button"
            onClick={() => doFetch()}
            title={st.refresh_peer_list}
            className="px-2.5 py-1 typo-caption rounded-card border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {st.refresh}
          </button>
          {lastScannedAt !== null && (
            <span className="text-[10px] text-foreground">
              {st.scanned_label} <RelativeTime timestamp={lastScannedAt} showTooltip={false} />
            </span>
          )}
        </div>
      </div>

      {networkError && (
        <div className="flex items-center gap-2 rounded-card border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2 typo-caption text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{st.peer_list_stale} {networkError}</span>
        </div>
      )}

      {loading ? (
        <PeerScanSkeleton />
      ) : discoveredPeers.length === 0 ? (
        <RadarEmptyState />
      ) : (
        <div className="space-y-2">
          {discoveredPeers.map((peer) => (
              <div className="animate-fade-slide-in"
                key={peer.peer_id}
              >
                <PeerCard
                  peer={peer}
                  connectionState={connectionStates[peer.peer_id]}
                  isTrusted={trustedPeerIds.has(peer.peer_id)}
                  onConnect={handleConnect}
                  onDisconnect={handleDisconnect}
                  onSelect={setSelectedPeerId}
                  connecting={connectingPeers.has(peer.peer_id)}
                />
              </div>
            ))}
        </div>
      )}

      {/* Detail drawer */}
      {selectedPeer && (
        <PeerDetailDrawer
          peer={selectedPeer}
          connectionState={connectionStates[selectedPeer.peer_id]}
          isTrusted={trustedPeerIds.has(selectedPeer.peer_id)}
          onClose={() => setSelectedPeerId(null)}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
      )}
    </section>
  );
}

/** Persistent radar animation shown when no peers are discovered. */
function RadarEmptyState() {
  const { t: _t } = useTranslation();
  const st = _t.sharing;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    const size = 120;
    canvas.width = size;
    canvas.height = size;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 4;

    function draw(time: number) {
      ctx!.clearRect(0, 0, size, size);
      const angle = ((time % 3000) / 3000) * Math.PI * 2;

      // Sweep gradient
      const grad = ctx!.createConicGradient(angle, cx, cy);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.15, 'rgba(52,211,153,0.12)');
      grad.addColorStop(0.3, 'transparent');
      grad.addColorStop(1, 'transparent');

      ctx!.beginPath();
      ctx!.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx!.fillStyle = grad;
      ctx!.fill();

      // Concentric rings
      for (const r of [radius * 0.33, radius * 0.66, radius]) {
        ctx!.beginPath();
        ctx!.arc(cx, cy, r, 0, Math.PI * 2);
        ctx!.strokeStyle = 'rgba(52,211,153,0.08)';
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      // Center dot
      ctx!.beginPath();
      ctx!.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx!.fillStyle = 'rgba(52,211,153,0.5)';
      ctx!.fill();

      // Sweep line
      ctx!.beginPath();
      ctx!.moveTo(cx, cy);
      ctx!.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx!.strokeStyle = 'rgba(52,211,153,0.25)';
      ctx!.lineWidth = 1.5;
      ctx!.stroke();

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="animate-fade-slide-in flex flex-col items-center gap-3 rounded-modal border border-border/50 p-6"
    >
      <canvas
        ref={canvasRef}
        className="w-[120px] h-[120px] opacity-80"
        style={{ imageRendering: 'auto' }}
      />
      <div className="flex items-center gap-1.5 typo-caption text-foreground">
        <Wifi className="w-3.5 h-3.5 text-emerald-400/50" />
        {st.scanning_network}
      </div>
      <span className="text-[11px] text-foreground text-center max-w-[260px]">
        {st.lan_hint}
      </span>
    </div>
  );
}

/**
 * Placeholder shown while the initial peer fetch is in flight (not tied to
 * any user-initiated "scan" action — that's `RadarEmptyState`'s continuous
 * canvas sweep below, left untouched as a deliberate ambient-discovery
 * indicator). This one is a cold-load skeleton: calm bars, delayed entrance,
 * geometry-matched to `PeerCard`. No continuous/looping motion.
 */
function PeerScanSkeleton() {
  const { t: _t } = useTranslation();
  const _st = _t.sharing;
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className="flex items-center gap-2 typo-caption text-foreground mb-2">
        <Wifi className="w-4 h-4 text-emerald-400/60" />
        {_st.scanning_network}
      </div>

      {/* Skeleton PeerCard placeholders */}
      <div className="w-full space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-modal border border-border bg-secondary/20 p-3 flex items-center gap-3 animate-fade-in"
            style={{ animationDelay: `${120 + i * 35}ms` }}
          >
            <span className="w-8 h-8 rounded-full bg-primary/[0.06] flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <span className="block h-3 w-2/5 rounded bg-primary/[0.06]" />
              <span className="block h-2.5 w-3/5 rounded bg-primary/[0.06]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
