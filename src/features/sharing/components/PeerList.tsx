import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Users, RefreshCw, Wifi, AlertTriangle } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { PeerCard } from './PeerCard';
import { PeerDetailDrawer } from './PeerDetailDrawer';
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';

const logger = createLogger("peer-list");

function useRelativeTime(ts: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (ts === null) return;
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [ts]);

  if (ts === null) return '';
  const diff = Date.now() - ts;
  if (diff < 10_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

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
    } catch {
      /* networkError store handles display */
    }
  }, [fetchNetworkSnapshot]);

  // No interval here — NetworkDashboard drives the shared 5s snapshot poll.
  // PeerList just does a one-time initial fetch and supports manual refresh.
  useEffect(() => {
    doFetch().finally(() => setLoading(false));
  }, [doFetch]);

  const lastScannedLabel = useRelativeTime(lastScannedAt);

  const handleConnect = async (peerId: string) => {
    setConnectingPeers((prev) => new Set(prev).add(peerId));
    try {
      await connectToPeer(peerId);
      addToast('Connected to peer', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to connect to peer', { peerId, error: msg });
      addToast(`Failed to connect to peer: ${msg}`, 'error');
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
      addToast('Disconnected from peer', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to disconnect', { peerId, error: msg });
      addToast(`Failed to disconnect: ${msg}`, 'error');
    }
  };

  const selectedPeer = discoveredPeers.find((p) => p.peer_id === selectedPeerId) ?? null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="w-4 h-4" />
          {st.discovered_peers}
        </h3>
        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={() => doFetch()}
            title="Refresh peer list"
            className="px-2.5 py-1 text-xs rounded-card border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {st.refresh}
          </button>
          {lastScannedLabel && (
            <span className="text-[10px] text-foreground">
              scanned {lastScannedLabel}
            </span>
          )}
        </div>
      </div>

      {networkError && (
        <div className="flex items-center gap-2 rounded-card border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Peer list may be stale &mdash; {networkError}</span>
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
      <div className="flex items-center gap-1.5 text-xs text-foreground">
        <Wifi className="w-3.5 h-3.5 text-emerald-400/50" />
        {st.scanning_network}
      </div>
      <span className="text-[11px] text-foreground text-center max-w-[260px]">
        {st.lan_hint}
      </span>
    </div>
  );
}

/** Skeleton loader that simulates a network scan with radar-sweep animation. */
function PeerScanSkeleton() {
  const { t: _t } = useTranslation();
  const _st = _t.sharing;
  return (
    <div className="relative flex flex-col items-center gap-3 py-6">
      {/* Central Wi-Fi icon with ping ring */}
      <div className="relative mb-2">
        <Wifi className="w-6 h-6 text-emerald-400/60" />
        <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/20" />
      </div>
      <span className="text-xs text-foreground mb-2">{_st.scanning_network}</span>

      {/* Skeleton PeerCard placeholders */}
      <div className="w-full space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-modal border border-border bg-secondary/20 p-3 flex items-center gap-3"
          >
            {/* Avatar circle */}
            <div className="w-8 h-8 rounded-full bg-secondary/50 flex-shrink-0" />
            {/* Text lines */}
            <div className="flex-1 space-y-2">
              <div className="h-3 w-2/5 rounded bg-secondary/50" />
              <div className="h-2.5 w-3/5 rounded bg-secondary/40" />
            </div>
            {/* Radar sweep overlay */}
            <div
              className="pointer-events-none absolute inset-0 -translate-x-full animate-[skeleton-sweep_2s_ease-in-out_infinite]"
              style={{ animationDelay: `${i * 0.3}s`, background: 'linear-gradient(90deg, transparent 0%, rgba(52,211,153,0.08) 50%, transparent 100%)' }}
            />
          </div>
        ))}
      </div>

      {/* keyframes injected via style tag (scoped, only mounts once) */}
      <style>{`@keyframes skeleton-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
    </div>
  );
}
