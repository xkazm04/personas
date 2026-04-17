import { useState } from 'react';
import {
  Wifi, WifiOff, Radio, Users, AlertTriangle, Hash,
  MessageSquare, Link2, RefreshCw, ChevronDown,
  ArrowUpRight, ArrowDownLeft,
  type LucideIcon,
} from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  ConnectionHealth,
  MessagingMetrics,
  ConnectionMetricsSnapshot,
  ManifestSyncMetrics,
} from '@/api/network/discovery';

function healthColor(health: ConnectionHealth | null): string {
  if (!health || health.connectedCount === 0) return 'var(--muted-foreground)';
  if (health.missedPingCount > 0) return 'var(--status-error)';
  const avg = health.avgLatencyMs;
  if (avg === null) return 'var(--muted-foreground)';
  if (avg < 100) return 'var(--status-success)';
  if (avg <= 500) return 'var(--status-warning)';
  return 'var(--status-error)';
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
    <div className="rounded-card border border-border bg-secondary/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-foreground mb-1">
        {label}
      </div>
      <div className="typo-heading-lg font-semibold text-foreground">{children}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-foreground">{label}</span>
      <span className="text-[11px] font-mono text-foreground">{value}</span>
    </div>
  );
}

function MetricsSection({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-card border border-border bg-secondary/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary/20 transition-colors rounded-card"
      >
        <Icon className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
        <span className="text-[11px] font-medium text-foreground flex-1">{title}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3 pb-2 divide-y divide-border/50">{children}</div>
          </div>
        )}
    </div>
  );
}

function MessagingMetricsPanel({ m }: { m: MessagingMetrics }) {
  return (
    <MetricsSection title="Message Throughput" icon={MessageSquare}>
      <MetricRow
        label="Sent"
        value={
          <span className="flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3 text-emerald-400" />
            {m.messagesSent.toLocaleString()}
            <span className="text-foreground ml-1">({formatBytes(m.bytesSent)})</span>
          </span>
        }
      />
      <MetricRow
        label="Received"
        value={
          <span className="flex items-center gap-1">
            <ArrowDownLeft className="w-3 h-3 text-blue-400" />
            {m.messagesReceived.toLocaleString()}
            <span className="text-foreground ml-1">({formatBytes(m.bytesReceived)})</span>
          </span>
        }
      />
      {(m.messagesDroppedBufferFull > 0 || m.messagesRateLimited > 0) && (
        <>
          {m.messagesDroppedBufferFull > 0 && (
            <MetricRow
              label="Dropped (buffer full)"
              value={<span className="text-amber-400">{m.messagesDroppedBufferFull}</span>}
            />
          )}
          {m.messagesRateLimited > 0 && (
            <MetricRow
              label="Rate limited"
              value={<span className="text-amber-400">{m.messagesRateLimited}</span>}
            />
          )}
        </>
      )}
    </MetricsSection>
  );
}

function ConnectionMetricsPanel({ m }: { m: ConnectionMetricsSnapshot }) {
  const totalDropped =
    m.connectionsDroppedHealth +
    m.connectionsDroppedUser +
    m.connectionsDroppedShutdown +
    m.connectionsDroppedProtocol;

  return (
    <MetricsSection title="Connection Lifecycle" icon={Link2}>
      <MetricRow label="Attempts" value={m.connectionAttempts.toLocaleString()} />
      <MetricRow label="Established" value={m.connectionsEstablished.toLocaleString()} />
      <MetricRow
        label="Avg connect time"
        value={
          m.avgConnectDurationMs != null
            ? `${Math.round(m.avgConnectDurationMs)}ms`
            : '—'
        }
      />
      {totalDropped > 0 && (
        <MetricRow
          label="Disconnects"
          value={
            <span className="text-foreground">
              {totalDropped}
              <span className="ml-1 text-[10px]">
                (H:{m.connectionsDroppedHealth} U:{m.connectionsDroppedUser} S:{m.connectionsDroppedShutdown} P:{m.connectionsDroppedProtocol})
              </span>
            </span>
          }
        />
      )}
      {m.connectionsRejectedCapacity > 0 && (
        <MetricRow
          label="Rejected (capacity)"
          value={<span className="text-amber-400">{m.connectionsRejectedCapacity}</span>}
        />
      )}
    </MetricsSection>
  );
}

function ManifestSyncPanel({ m }: { m: ManifestSyncMetrics }) {
  const successRate =
    m.syncRounds > 0
      ? ((m.syncSuccesses / m.syncRounds) * 100).toFixed(0)
      : null;

  return (
    <MetricsSection title="Manifest Sync" icon={RefreshCw}>
      <MetricRow label="Sync rounds" value={m.syncRounds.toLocaleString()} />
      <MetricRow
        label="Success / Fail"
        value={
          <span>
            <span className="text-emerald-400">{m.syncSuccesses}</span>
            {' / '}
            <span className={m.syncFailures > 0 ? 'text-red-400' : ''}>{m.syncFailures}</span>
            {successRate != null && (
              <span className="text-foreground ml-1 text-[10px]">({successRate}%)</span>
            )}
          </span>
        }
      />
      <MetricRow
        label="Avg sync duration"
        value={
          m.avgSyncDurationMs != null
            ? `${Math.round(m.avgSyncDurationMs)}ms`
            : '—'
        }
      />
      <MetricRow
        label="Entries received"
        value={m.totalEntriesReceived.toLocaleString()}
      />
    </MetricsSection>
  );
}

export function NetworkDashboard() {
  const networkStatus = useSystemStore((s) => s.networkStatus);
  const networkError = useSystemStore((s) => s.networkError);
  const health = useSystemStore((s) => s.connectionHealth);
  const messagingMetrics = useSystemStore((s) => s.messagingMetrics);
  const connectionMetrics = useSystemStore((s) => s.connectionMetrics);
  const manifestSyncMetrics = useSystemStore((s) => s.manifestSyncMetrics);
  const fetchNetworkSnapshot = useSystemStore((s) => s.fetchNetworkSnapshot);
  // Primary updates arrive via Tauri event (network:snapshot-updated) pushed
  // from the Rust P2P engine whenever state changes. This 30-second poll is
  // a staleness-detection fallback only.
  usePolling(fetchNetworkSnapshot, { interval: 30_000, enabled: true });

  const { t } = useTranslation();
  const st = t.sharing;
  const isRunning = networkStatus?.is_running ?? false;
  const color = healthColor(health);
  const label = healthLabel(health);

  return (
    <section>
      <h3 className="typo-heading font-semibold text-foreground mb-3 flex items-center gap-2">
        <Radio className="w-4 h-4" />
        {st.network_status}
      </h3>
      {networkError && (
        <div className="flex items-center gap-2 rounded-card border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2 typo-caption text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Network data may be stale &mdash; {networkError}</span>
        </div>
      )}

      {!networkStatus ? (
        <div className="rounded-card border border-border bg-secondary/10 p-4 flex items-center gap-3 typo-body text-foreground">
          <div className="relative">
            <Wifi className="w-4 h-4 text-emerald-400/50" />
            <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/20" />
          </div>
          {st.checking_network}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Stat cards grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Status card */}
            <StatCard label={st.stat_status}>
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <div className="relative w-4 h-4 flex-shrink-0">
                    <Wifi className="w-4 h-4 text-emerald-400" />
                    <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/25" />
                  </div>
                ) : (
                  <WifiOff className="w-4 h-4 text-foreground flex-shrink-0" />
                )}
                <span className={isRunning ? 'text-emerald-400' : 'text-foreground'}>
                  {isRunning ? st.status_online : st.status_offline}
                </span>
              </div>
            </StatCard>

            {/* Port card */}
            <StatCard label={st.stat_port}>
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-foreground flex-shrink-0" />
                <span className="font-mono">
                  {isRunning && networkStatus.listening_port
                    ? networkStatus.listening_port
                    : '—'}
                </span>
              </div>
            </StatCard>

            {/* Discovered peers card */}
            <StatCard label={st.stat_discovered}>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-foreground flex-shrink-0" />
                <span>{isRunning ? networkStatus.discovered_peer_count : 0}</span>
              </div>
            </StatCard>

            {/* Connected peers card */}
            <StatCard label={st.stat_connected}>
              <div className="flex items-center gap-2">
                {/* Health pulse ring */}
                <div className="relative w-4 h-4 flex items-center justify-center flex-shrink-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full block"
                    style={{ backgroundColor: color }}
                  />
                  {health && health.connectedCount > 0 && (
                    <span
                      className="animate-fade-in absolute w-2.5 h-2.5 rounded-full"
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
              <span className="text-[10px] uppercase tracking-wider text-foreground">Peer ID</span>
              <span className="text-[11px] font-mono text-foreground">
                {networkStatus.local_peer_id.slice(0, 8)}...{networkStatus.local_peer_id.slice(-8)}
              </span>
            </div>
          )}

          {/* P2P Metrics panels */}
          {isRunning && (messagingMetrics || connectionMetrics || manifestSyncMetrics) && (
            <div className="space-y-2 pt-2">
              {messagingMetrics && <MessagingMetricsPanel m={messagingMetrics} />}
              {connectionMetrics && <ConnectionMetricsPanel m={connectionMetrics} />}
              {manifestSyncMetrics && <ManifestSyncPanel m={manifestSyncMetrics} />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
