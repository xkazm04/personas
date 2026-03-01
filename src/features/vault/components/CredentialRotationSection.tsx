import { useState } from 'react';
import { Trash2, Pencil, RotateCw, ShieldCheck, AlertTriangle, Clock, Plus, Activity, TrendingDown, XCircle } from 'lucide-react';
import * as api from '@/api/tauriApi';
import type { RotationStatus, AnomalyScore } from '@/api/rotation';
import { createRotationPolicy, updateRotationPolicy, rotateCredentialNow, deleteRotationPolicy } from '@/api/rotation';
import { formatRelativeTime } from '@/lib/utils/formatters';

interface CredentialRotationSectionProps {
  credentialId: string;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  onRefresh: () => Promise<void>;
  onHealthcheck: (id: string) => void;
}

const REMEDIATION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  healthy: { label: 'Healthy', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  backoff_retry: { label: 'Transient Issues', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  preemptive_rotation: { label: 'Degrading', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  rotate_then_alert: { label: 'Permanent Errors', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  disable: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/25' },
};

function AnomalyScorePanel({ score, tolerance }: { score: AnomalyScore; tolerance: number }) {
  const rem = REMEDIATION_LABELS[score.remediation] ?? REMEDIATION_LABELS.healthy!;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <div className={`rounded-xl border px-3 py-2.5 space-y-2 ${rem.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className={`w-3.5 h-3.5 ${rem.color}`} />
          <span className={`text-sm font-medium ${rem.color}`}>{rem.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {score.data_stale && (
            <span className="text-xs text-muted-foreground/60 bg-secondary/40 px-1.5 py-0.5 rounded">stale</span>
          )}
          <span className="text-xs text-muted-foreground/60 tabular-nums">{score.sample_count} samples</span>
        </div>
      </div>

      {/* Failure rate bars */}
      <div className="grid grid-cols-3 gap-2">
        <RateBar label="5m" rate={score.failure_rate_5m} threshold={tolerance} />
        <RateBar label="1h" rate={score.failure_rate_1h} threshold={tolerance} />
        <RateBar label="24h" rate={score.failure_rate_24h} threshold={tolerance} />
      </div>

      {/* Error classification breakdown */}
      {(score.permanent_failure_rate_1h > 0 || score.transient_failure_rate_1h > 0) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground/80">
          {score.permanent_failure_rate_1h > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Permanent: {pct(score.permanent_failure_rate_1h)}
            </span>
          )}
          {score.transient_failure_rate_1h > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Transient: {pct(score.transient_failure_rate_1h)}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <TrendingDown className="w-3 h-3" />
            Tolerance: {pct(tolerance)}
          </span>
        </div>
      )}
    </div>
  );
}

function RateBar({ label, rate, threshold }: { label: string; rate: number; threshold: number }) {
  const pct = Math.min(rate * 100, 100);
  const isOver = rate > threshold;
  const barColor = isOver ? 'bg-red-400' : rate > 0 ? 'bg-amber-400' : 'bg-emerald-400/60';

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/70 font-mono">{label}</span>
        <span className={`text-xs font-mono tabular-nums ${isOver ? 'text-red-400' : 'text-muted-foreground/80'}`}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-1 bg-secondary/30 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CredentialRotationSection({
  credentialId,
  rotationStatus,
  rotationCountdown,
  onRefresh,
  onHealthcheck,
}: CredentialRotationSectionProps) {
  const [isRotating, setIsRotating] = useState(false);
  const [rotationDays, setRotationDays] = useState(rotationStatus?.rotation_interval_days ?? 90);
  const [isEditingPeriod, setIsEditingPeriod] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const anomalyScore = rotationStatus?.anomaly_score ?? null;
  const showAnomalyPanel = anomalyScore && anomalyScore.sample_count > 0;

  return (
    <div className="space-y-3">
      {/* Windowed Anomaly Score Panel */}
      {showAnomalyPanel && (
        <AnomalyScorePanel
          score={anomalyScore}
          tolerance={rotationStatus?.anomaly_tolerance ?? 0.8}
        />
      )}

      {/* Legacy Anomaly Warning (only if no windowed data available) */}
      {!showAnomalyPanel && rotationStatus?.anomaly_detected && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Anomaly detected: credential suddenly failing after previous success. Possible revocation.</span>
        </div>
      )}

      {/* Action error banner */}
      {actionError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 p-0.5 hover:bg-red-500/10 rounded transition-colors">
            <XCircle className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Rotation Status Summary */}
      {rotationStatus?.has_policy ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${rotationStatus.policy_enabled ? 'text-cyan-400' : 'text-muted-foreground/80'}`} />
              <div className="text-sm">
                <span className={rotationStatus.policy_enabled ? 'text-cyan-400 font-medium' : 'text-muted-foreground/90'}>
                  {rotationStatus.policy_enabled ? 'Auto-rotation active' : 'Rotation paused'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {rotationCountdown && rotationStatus.policy_enabled && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground/90 font-mono">
                  <Clock className="w-3 h-3" />
                  {rotationCountdown}
                </span>
              )}
              <button
                onClick={async () => {
                  setIsRotating(true);
                  setActionError(null);
                  try {
                    await rotateCredentialNow(credentialId);
                    await onRefresh();
                    onHealthcheck(credentialId);
                  } catch (err) {
                    setActionError(`Rotation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                  } finally {
                    setIsRotating(false);
                  }
                }}
                disabled={isRotating}
                data-testid="rotation-rotate-now-btn"
                className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              >
                <RotateCw className={`w-3 h-3 ${isRotating ? 'animate-spin' : ''}`} />
                Rotate Now
              </button>
              <button
                onClick={async () => {
                  setActionError(null);
                  try {
                    const allPolicies = await api.listRotationPolicies(credentialId);
                    for (const p of allPolicies) {
                      await deleteRotationPolicy(p.id);
                    }
                    await onRefresh();
                  } catch (err) {
                    setActionError(`Failed to remove policy: ${err instanceof Error ? err.message : 'Unknown error'}`);
                  }
                }}
                data-testid="rotation-delete-policy-btn"
                className="p-1 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Remove rotation policy"
              >
                <Trash2 className="w-3 h-3 text-red-400/50" />
              </button>
            </div>
          </div>

          {/* Rotation period editor */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground/80">Rotate every</span>
            {isEditingPeriod ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={rotationDays}
                  onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  min={1}
                  data-testid="rotation-days-input"
                  className="w-16 px-2 py-0.5 bg-background/50 border border-cyan-500/25 rounded-md text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                />
                <span className="text-sm text-muted-foreground/80">days</span>
                <button
                  onClick={async () => {
                    setActionError(null);
                    try {
                      const allPolicies = await api.listRotationPolicies(credentialId);
                      if (allPolicies.length > 0) {
                        await updateRotationPolicy(allPolicies[0]!.id, { rotation_interval_days: rotationDays });
                      }
                      await onRefresh();
                      setIsEditingPeriod(false);
                    } catch (err) {
                      setActionError(`Failed to update rotation period: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    }
                  }}
                  data-testid="rotation-save-period-btn"
                  className="px-2 py-0.5 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/25 text-cyan-400 rounded-md text-sm font-medium transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setRotationDays(rotationStatus.rotation_interval_days ?? 90);
                    setIsEditingPeriod(false);
                  }}
                  data-testid="rotation-cancel-period-btn"
                  className="px-2 py-0.5 text-muted-foreground/80 hover:text-foreground/90 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsEditingPeriod(true)}
                data-testid="rotation-edit-period-btn"
                className="flex items-center gap-1 px-2 py-0.5 bg-secondary/40 hover:bg-secondary/60 border border-primary/15 rounded-md text-sm text-foreground/80 transition-colors"
              >
                <span className="font-mono">{rotationStatus.rotation_interval_days ?? 90}</span>
                <span>days</span>
                <Pencil className="w-2.5 h-2.5 text-muted-foreground/60 ml-0.5" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground/80">No rotation policy configured.</p>

          {/* Period selection */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground/80">Rotate every</span>
            <div className="flex items-center gap-1">
              {[30, 60, 90, 180].map((d) => (
                <button
                  key={d}
                  onClick={() => setRotationDays(d)}
                  data-testid={`rotation-preset-${d}-btn`}
                  className={`px-2 py-0.5 rounded-md text-sm font-mono transition-colors ${
                    rotationDays === d
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                      : 'bg-secondary/40 text-muted-foreground/80 border border-transparent hover:bg-secondary/60'
                  }`}
                >
                  {d}d
                </button>
              ))}
              <input
                type="number"
                value={rotationDays}
                onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                min={1}
                data-testid="rotation-custom-days-input"
                className="w-16 px-2 py-0.5 bg-background/50 border border-primary/15 rounded-md text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
              />
              <span className="text-sm text-muted-foreground/60">days</span>
            </div>
          </div>

          <button
            onClick={async () => {
              setActionError(null);
              try {
                await createRotationPolicy({
                  credential_id: credentialId,
                  rotation_interval_days: rotationDays,
                  policy_type: 'scheduled',
                  enabled: true,
                });
                await onRefresh();
              } catch (err) {
                setActionError(`Failed to enable rotation: ${err instanceof Error ? err.message : 'Unknown error'}`);
              }
            }}
            data-testid="rotation-enable-btn"
            className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 rounded-lg text-sm font-medium transition-all"
          >
            <Plus className="w-3 h-3" />
            Enable Rotation
          </button>
        </div>
      )}

      {/* Last Rotation Info */}
      {rotationStatus?.last_rotated_at && (
        <div className="text-sm text-muted-foreground/80">
          Last rotated {formatRelativeTime(rotationStatus.last_rotated_at)}
          {rotationStatus.last_status && (
            <span className={`ml-1.5 ${
              rotationStatus.last_status === 'success' ? 'text-emerald-400/60' : 'text-red-400/60'
            }`}>
              ({rotationStatus.last_status})
            </span>
          )}
        </div>
      )}

      {/* Rotation History Timeline */}
      {rotationStatus && rotationStatus.recent_history.length > 0 && (
        <>
          <div className="border-t border-primary/10" />
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground/60 uppercase tracking-wider font-semibold">History</p>
            <div className="space-y-1 max-h-[160px] overflow-y-auto">
              {rotationStatus.recent_history.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-sm" data-testid={`rotation-history-${entry.id}`}>
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    entry.status === 'success' ? 'bg-emerald-400' :
                    entry.status === 'failed' ? 'bg-red-400' :
                    'bg-amber-400/60'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-muted-foreground/90 font-mono">{entry.rotation_type}</span>
                    {entry.detail && (
                      <span className="text-muted-foreground/80 ml-1.5 truncate">{entry.detail}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground/80 shrink-0">
                    {formatRelativeTime(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
