import { useState } from 'react';
import { AlertTriangle, XCircle, DatabaseZap } from 'lucide-react';
import type { RotationStatus } from '@/api/vault/rotation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { AnomalyScorePanel } from '@/features/vault/sub_features/AnomalyScorePanel';
import { RotationPolicyControls } from '@/features/vault/sub_features/RotationPolicyControls';

interface CredentialRotationSectionProps {
  credentialId: string;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  isOAuth?: boolean;
  onRefresh: () => Promise<void>;
  onHealthcheck: (id: string) => void;
}

export function CredentialRotationSection({
  credentialId,
  rotationStatus,
  rotationCountdown,
  isOAuth,
  onRefresh,
  onHealthcheck,
}: CredentialRotationSectionProps) {
  const [actionError, setActionError] = useState<string | null>(null);

  const anomalyScore = rotationStatus?.anomaly_score ?? null;
  const showAnomalyPanel = anomalyScore && anomalyScore.sample_count > 0;

  return (
    <div className="space-y-3">
      {/* Corrupted Healthcheck Warning */}
      {rotationStatus?.healthcheck_corrupted && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/20 text-sm text-orange-400">
          <DatabaseZap className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Healthcheck metadata is corrupted. Anomaly scores are unavailable until the next successful healthcheck overwrites the bad data.</span>
        </div>
      )}

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

      {/* Rotation Policy Controls */}
      {rotationStatus && (
        <RotationPolicyControls
          credentialId={credentialId}
          rotationStatus={rotationStatus}
          rotationCountdown={rotationCountdown}
          isOAuth={isOAuth}
          onRefresh={onRefresh}
          onHealthcheck={onHealthcheck}
          onError={setActionError}
        />
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
