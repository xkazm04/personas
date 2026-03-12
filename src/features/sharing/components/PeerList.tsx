import { useEffect, useState } from 'react';
import { Users, Loader2, RefreshCw } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { PeerCard } from './PeerCard';
import { PeerDetailDrawer } from './PeerDetailDrawer';

export function PeerList() {
  const discoveredPeers = usePersonaStore((s) => s.discoveredPeers);
  const connectionStates = usePersonaStore((s) => s.connectionStates);
  const trustedPeers = usePersonaStore((s) => s.trustedPeers);
  const fetchDiscoveredPeers = usePersonaStore((s) => s.fetchDiscoveredPeers);
  const connectToPeer = usePersonaStore((s) => s.connectToPeer);
  const disconnectPeer = usePersonaStore((s) => s.disconnectPeer);
  const addToast = useToastStore((s) => s.addToast);

  const [loading, setLoading] = useState(true);
  const [connectingPeers, setConnectingPeers] = useState<Set<string>>(new Set());
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);

  const trustedPeerIds = new Set(trustedPeers.map((p) => p.peer_id));

  useEffect(() => {
    fetchDiscoveredPeers().finally(() => setLoading(false));
    const interval = setInterval(fetchDiscoveredPeers, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async (peerId: string) => {
    setConnectingPeers((prev) => new Set(prev).add(peerId));
    try {
      await connectToPeer(peerId);
      addToast('Connected to peer', 'success');
    } catch {
      addToast('Failed to connect to peer', 'error');
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
    } catch {
      addToast('Failed to disconnect', 'error');
    }
  };

  const selectedPeer = discoveredPeers.find((p) => p.peer_id === selectedPeerId) ?? null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="w-4 h-4" />
          Discovered Peers
        </h3>
        <button
          onClick={() => fetchDiscoveredPeers()}
          title="Refresh peer list"
          className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Scanning local network...
        </div>
      ) : discoveredPeers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No peers discovered on the local network yet. Other Personas instances on the same LAN will appear here automatically.
        </div>
      ) : (
        <div className="space-y-2">
          {discoveredPeers.map((peer) => (
            <PeerCard
              key={peer.peer_id}
              peer={peer}
              connectionState={connectionStates[peer.peer_id]}
              isTrusted={trustedPeerIds.has(peer.peer_id)}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onSelect={setSelectedPeerId}
              connecting={connectingPeers.has(peer.peer_id)}
            />
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
