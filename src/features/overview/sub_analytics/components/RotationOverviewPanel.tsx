import { memo, useEffect, useMemo } from 'react';
import {
  RotateCw, Shield, ShieldOff, AlertTriangle,
  CheckCircle2, Clock, TrendingDown, Timer,
} from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";
import type { RotationOverviewItem } from '@/stores/slices/vault/rotationSlice';

function rotationBadge(item: RotationOverviewItem) {
  const { status } = item;

  if (!status.has_policy) {
    if (status.anomaly_detected) {
      return { label: 'Anomaly', classes: 'bg-red-500/15 border-red-500/25 text-red-400', Icon: AlertTriangle };
    }
    return null;
  }

  if (!status.policy_enabled) {
    return { label: 'Paused', classes: 'bg-zinc-500/15 border-zinc-500/25 text-zinc-400', Icon: ShieldOff };
  }

  const rem = status.anomaly_score?.remediation;
  if (rem === 'disable') {
    return { label: 'Disabled', classes: 'bg-red-500/15 border-red-500/25 text-red-400', Icon: ShieldOff };
  }
  if (rem === 'rotate_then_alert') {
    return { label: 'Perm Errors', classes: 'bg-red-500/10 border-red-500/20 text-red-400', Icon: AlertTriangle };
  }
  if (rem === 'preemptive_rotation') {
    return { label: 'Degrading', classes: 'bg-orange-500/10 border-orange-500/20 text-orange-400', Icon: TrendingDown };
  }
  if (rem === 'backoff_retry') {
    return { label: 'Backoff', classes: 'bg-amber-500/10 border-amber-500/20 text-amber-400', Icon: Timer };
  }

  // Fresh / healthy
  if (status.last_status === 'success') {
    return { label: 'Fresh', classes: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', Icon: CheckCircle2 };
  }

  return { label: 'Active', classes: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400', Icon: Shield };
}

function countdownLabel(nextRotation: string | null): string {
  if (!nextRotation) return '';
  const diff = new Date(nextRotation).getTime() - Date.now();
  if (diff <= 0) return 'due now';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

function summaryStats(items: RotationOverviewItem[]) {
  let active = 0;
  let expiringSoon = 0;
  let anomalies = 0;
  for (const item of items) {
    if (item.status.has_policy && item.status.policy_enabled) active++;
    if (item.status.anomaly_detected) anomalies++;
    if (item.status.next_rotation_at) {
      const diff = new Date(item.status.next_rotation_at).getTime() - Date.now();
      if (diff > 0 && diff < 7 * 24 * 60 * 60 * 1000) expiringSoon++;
    }
  }
  return { active, expiringSoon, anomalies, total: items.length };
}

export const RotationOverviewPanel = memo(function RotationOverviewPanel() {
  const rotationOverviewList = useVaultStore((s) => s.rotationOverviewList);
  const fetchAllRotationStatuses = useVaultStore((s) => s.fetchAllRotationStatuses);
  const credentials = useVaultStore((s) => s.credentials);

  useEffect(() => {
    if (credentials.length > 0) {
      fetchAllRotationStatuses();
    }
  }, [credentials.length, fetchAllRotationStatuses]);

  const stats = useMemo(() => summaryStats(rotationOverviewList), [rotationOverviewList]);

  if (rotationOverviewList.length === 0 && credentials.length > 0) {
    return null; // No rotation policies configured -- don't show the panel
  }

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-primary/5 bg-gradient-to-r from-secondary/40 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 shadow-inner flex items-center justify-center">
            <RotateCw className="w-4 h-4 text-violet-400" />
          </div>
          <h3 className="text-sm font-bold text-foreground/90 uppercase tracking-widest">Credential Rotation</h3>
          {stats.total > 0 && (
            <span className="px-2 py-0.5 text-sm font-black tracking-wide rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 shadow-sm">
              {stats.total}
            </span>
          )}
        </div>

        {/* Summary pills */}
        <div className="flex items-center gap-2">
          {stats.active > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Shield className="w-3 h-3" />{stats.active} active
            </span>
          )}
          {stats.expiringSoon > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Clock className="w-3 h-3" />{stats.expiringSoon} soon
            </span>
          )}
          {stats.anomalies > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
              <AlertTriangle className="w-3 h-3" />{stats.anomalies} issue{stats.anomalies !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Rotation items list */}
      {rotationOverviewList.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <div className="text-center flex flex-col items-center">
            <div className="w-14 h-14 rounded-xl bg-violet-500/10 border border-violet-500/20 shadow-inner flex items-center justify-center mb-4 opacity-70">
              <RotateCw className="w-6 h-6 text-violet-400" />
            </div>
            <p className="text-sm font-medium text-foreground/80">No rotation policies</p>
            <p className="text-sm text-muted-foreground mt-1">Configure rotation on credentials in the Vault.</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-primary/5 bg-gradient-to-b from-transparent to-black/[0.02]">
          {rotationOverviewList.map((item) => {
            const badge = rotationBadge(item);
            const countdown = countdownLabel(item.status.next_rotation_at);
            const lastRotated = item.status.last_rotated_at
              ? new Date(item.status.last_rotated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : null;

            return (
              <div key={item.credentialId} className="flex items-center gap-4 px-4 py-3.5 hover:bg-white/[0.03] transition-colors group">
                {/* Status badge */}
                {badge && (
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg border flex-shrink-0 ${badge.classes}`}>
                    <badge.Icon className="w-3 h-3" />
                    {badge.label}
                  </span>
                )}

                {/* Credential info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground/90 truncate">{item.credentialName}</p>
                  <p className="text-sm text-muted-foreground/70 truncate">{item.serviceType}</p>
                </div>

                {/* Interval */}
                {item.status.rotation_interval_days && (
                  <span className="text-sm text-muted-foreground/80 font-mono min-w-[50px] text-right">
                    {item.status.rotation_interval_days}d
                  </span>
                )}

                {/* Countdown */}
                {countdown && (
                  <span className={`text-sm font-mono min-w-[60px] text-right ${
                    countdown === 'due now' ? 'text-amber-400 font-medium' : 'text-muted-foreground/80'
                  }`}>
                    {countdown}
                  </span>
                )}

                {/* Last rotated */}
                <span className="text-sm text-muted-foreground/60 w-16 text-right">
                  {lastRotated ?? 'never'}
                </span>

                {/* Consecutive failures */}
                {item.status.consecutive_failures > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-sm font-mono rounded-lg bg-red-500/10 text-red-400 border border-red-500/20" title={`${item.status.consecutive_failures} consecutive failures`}>
                    {item.status.consecutive_failures}x fail
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
