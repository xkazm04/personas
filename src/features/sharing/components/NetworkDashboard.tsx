import { useEffect } from 'react';
import { Wifi, WifiOff, Radio, Users, AlertTriangle, Hash } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSystemStore } from "@/stores/systemStore";
import type { ConnectionHealth } from '@/api/network/discovery';

function healthColor(health: ConnectionHealth | null): string {
  if (!health || health.connectedCount === 0) return 'rgb(156 163 175)'; // gray
  if (health.missedPingCount > 0) return 'rgb(239 68 68)'; // red
  const avg = health.avgLatencyMs;
  if (avg === null) return 'rgb(156 163 175)'; // no data yet
  if (avg < 100) return 'rgb(52 211 153)'; // green
  if (avg <= 500) return 'rgb(251 191 36)'; // amber
  return 'rgb(239 68 68)'; // red
}

function healthLabel(health: ConnectionHealth | null): string | null {
  if (!health || health.connectedCount === 0) return null;
  if (health.missedPingCount > 0) return `${health.missedPingCount} missed`;
  const avg = health.avgLatencyMs;
  if (avg === null) return null;
  return `${Math.round(avg)}ms`;
}

function StatCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div className="text-lg font-semibold text-foreground">{children}</div>
    </div>
  );
}

export function NetworkDashboard() {
  const networkStatus = useSystemStore((s) => s.networkStatus);
  const networkError = useSystemStore((s) => s.networkError);
  const health = useSystemStore((s) => s.connectionHealth);
  const fetchNetworkSnapshot = useSystemStore((s) => s.fetchNetworkSnapshot);

  useEffect(() => {
    fetchNetworkSnapshot();
    const interval = setInterval(fetchNetworkSnapshot, 5000);
    return () => clearInterval(interval);
  }, []);

  const isRunning = networkStatus?.is_running ?? false;
  const color = healthColor(health);
  const label = healthLabel(health);

  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Radio className="w-4 h-4" />
        Network Status
      </h3>
      {networkError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Network data may be stale &mdash; {networkError}</span>
        </div>
      )}

      {!networkStatus ? (
        <div className="rounded-lg border border-border bg-secondary/10 p-4 flex items-center gap-3 text-sm text-muted-foreground">
          <div className="relative">
            <Wifi className="w-4 h-4 text-emerald-400/50" />
            <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/20" />
          </div>
          Checking network status...
        </div>
      ) : (
        <div className="space-y-2">
          {/* Stat cards grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Status card */}
            <StatCard label="Status">
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <div className="relative w-4 h-4 flex-shrink-0">
                    <Wifi className="w-4 h-4 text-emerald-400" />
                    <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/25" />
                  </div>
                ) : (
                  <WifiOff className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className={isRunning ? 'text-emerald-400' : 'text-muted-foreground'}>
                  {isRunning ? 'Online' : 'Offline'}
                </span>
              </div>
            </StatCard>

            {/* Port card */}
            <StatCard label="Port">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="font-mono">
                  {isRunning && networkStatus.listening_port
                    ? networkStatus.listening_port
                    : '—'}
                </span>
              </div>
            </StatCard>

            {/* Discovered peers card */}
            <StatCard label="Discovered">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span>{isRunning ? networkStatus.discovered_peer_count : 0}</span>
              </div>
            </StatCard>

            {/* Connected peers card */}
            <StatCard label="Connected">
              <div className="flex items-center gap-2">
                {/* Health pulse ring */}
                <div className="relative w-4 h-4 flex items-center justify-center flex-shrink-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full block"
                    style={{ backgroundColor: color }}
                  />
                  {health && health.connectedCount > 0 && (
                    <motion.span
                      animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.2, 0.6] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </div>
                <span>{isRunning ? networkStatus.connected_peer_count : 0}</span>
                {label && (
                  <span className="text-[10px] font-mono font-normal" style={{ color }}>
                    {label}
                  </span>
                )}
              </div>
            </StatCard>
          </div>

          {/* Peer ID footer */}
          {isRunning && networkStatus.local_peer_id && (
            <div className="flex items-center gap-1.5 px-1 pt-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Peer ID</span>
              <span className="text-[11px] font-mono text-foreground/50">
                {networkStatus.local_peer_id.slice(0, 8)}...{networkStatus.local_peer_id.slice(-8)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
