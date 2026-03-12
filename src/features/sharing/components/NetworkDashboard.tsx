import { useEffect } from 'react';
import { Wifi, WifiOff, Radio, Users, Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';

export function NetworkDashboard() {
  const networkStatus = usePersonaStore((s) => s.networkStatus);
  const fetchNetworkStatus = usePersonaStore((s) => s.fetchNetworkStatus);

  useEffect(() => {
    fetchNetworkStatus();
    const interval = setInterval(fetchNetworkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const isRunning = networkStatus?.is_running ?? false;

  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Radio className="w-4 h-4" />
        Network Status
      </h3>
      <div className="rounded-xl border border-border bg-secondary/20 p-4">
        {!networkStatus ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking network status...
          </div>
        ) : (
          <div className="flex items-center gap-6">
            {/* Status indicator */}
            <div className="flex items-center gap-2">
              {isRunning ? (
                <Wifi className="w-4 h-4 text-emerald-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-muted-foreground" />
              )}
              <span className={`text-sm font-medium ${isRunning ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                {isRunning ? 'Online' : 'Offline'}
              </span>
            </div>

            {/* Listening port */}
            {isRunning && networkStatus.listening_port && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Port</span>
                <span className="text-xs font-mono text-foreground/80">
                  {networkStatus.listening_port}
                </span>
              </div>
            )}

            {/* Peer counts */}
            {isRunning && (
              <>
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Discovered</span>
                  <span className="text-xs font-medium text-foreground/80">
                    {networkStatus.discovered_peer_count}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs text-muted-foreground">Connected</span>
                  <span className="text-xs font-medium text-foreground/80">
                    {networkStatus.connected_peer_count}
                  </span>
                </div>
              </>
            )}

            {/* Peer ID */}
            {isRunning && networkStatus.local_peer_id && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Peer ID</span>
                <span className="text-xs font-mono text-foreground/60">
                  {networkStatus.local_peer_id.slice(0, 8)}...{networkStatus.local_peer_id.slice(-8)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
