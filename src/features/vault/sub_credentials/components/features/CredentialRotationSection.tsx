import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, XCircle, DatabaseZap, History } from 'lucide-react';
import type { RotationStatus } from '@/api/vault/rotation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { AnomalyScorePanel } from '@/features/vault/sub_credentials/components/features/AnomalyScorePanel';
import { RotationPolicyControls } from '@/features/vault/sub_credentials/components/features/RotationPolicyControls';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useThemeStore } from '@/stores/themeStore';

/** Bottom 24px fade so the scroll boundary dissolves instead of cutting off abruptly. */
const HISTORY_FADE_MASK =
  'linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)';

/** Shape-matched shimmer rows (dot + text + time) shown while history is loading. */
function RotationHistorySkeleton() {
  const widths = ['62%', '46%', '70%'];
  return (
    <div className="space-y-1.5" aria-hidden="true" data-testid="rotation-history-skeleton">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/10 animate-pulse shrink-0" />
          <span className="h-3 rounded bg-primary/10 animate-pulse" style={{ width: w }} />
          <span className="h-3 w-10 rounded bg-primary/10 animate-pulse ml-auto shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface CredentialRotationSectionProps {
  credentialId: string;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  isOAuth?: boolean;
  /** True until the first rotation-status fetch resolves; drives the history skeleton. */
  isLoadingHistory?: boolean;
  onRefresh: () => Promise<void>;
  onHealthcheck: (id: string) => void;
}

export function CredentialRotationSection({
  credentialId,
  rotationStatus,
  rotationCountdown,
  isOAuth,
  isLoadingHistory = false,
  onRefresh,
  onHealthcheck,
}: CredentialRotationSectionProps) {
  const { t, tx } = useTranslation();
  const [actionError, setActionError] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const appReduceMotion = useThemeStore((s) => s.reduceMotion);
  const animateHistory = !prefersReducedMotion && !appReduceMotion;

  const anomalyScore = rotationStatus?.anomaly_score ?? null;
  const showAnomalyPanel = anomalyScore && anomalyScore.sample_count > 0;

  const recentHistory = rotationStatus?.recent_history ?? [];
  // Render the history block while loading (skeleton) or once a status has
  // resolved (list or empty state). When the status never arrives — e.g. a
  // failed fetch leaves it null — keep the section hidden, matching prior behavior.
  const showHistorySection = isLoadingHistory || rotationStatus !== null;

  return (
    <div className="space-y-3">
      {/* Corrupted Healthcheck Warning */}
      {rotationStatus?.healthcheck_corrupted && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-modal bg-orange-500/10 border border-orange-500/20 typo-body text-orange-400">
          <DatabaseZap className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{t.vault.rotation_section.corrupted_warning}</span>
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
        <div className="flex items-start gap-2 px-3 py-2 rounded-modal bg-amber-500/10 border border-amber-500/20 typo-body text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{t.vault.rotation_section.anomaly_warning}</span>
        </div>
      )}

      {/* Action error banner */}
      {actionError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-modal bg-red-500/10 border border-red-500/20 typo-body text-red-400">
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
        <div className="typo-body text-foreground">
          {tx(t.vault.rotation_section.last_rotated, { time: formatRelativeTime(rotationStatus.last_rotated_at) })}
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
      {showHistorySection && (
        <>
          <div className="border-t border-primary/10" />
          <div className="space-y-1.5">
            <p className="typo-heading text-foreground uppercase tracking-wider font-semibold">{t.vault.rotation_section.history}</p>
            {isLoadingHistory ? (
              <RotationHistorySkeleton />
            ) : recentHistory.length === 0 ? (
              <EmptyState
                icon={History}
                title={t.vault.rotation_section.history_empty_title}
                subtitle={t.vault.rotation_section.history_empty_subtitle}
                iconColor="text-violet-400/70"
                iconContainerClassName="bg-violet-500/10 border-violet-500/20"
                className="py-6"
              />
            ) : (
              <div
                className="space-y-1 max-h-[160px] overflow-y-auto"
                style={{ maskImage: HISTORY_FADE_MASK, WebkitMaskImage: HISTORY_FADE_MASK }}
              >
                {recentHistory.map((entry, index) => (
                  <motion.div
                    key={entry.id}
                    className="flex items-start gap-2 typo-body"
                    data-testid={`rotation-history-${entry.id}`}
                    initial={animateHistory ? { opacity: 0, y: 6 } : false}
                    animate={animateHistory ? { opacity: 1, y: 0 } : undefined}
                    transition={animateHistory ? { delay: Math.min(index * 0.03, 0.3), duration: 0.2, ease: 'easeOut' } : undefined}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ring-2 ring-current/20 ${
                      entry.status === 'success' ? 'bg-emerald-400 text-emerald-400' :
                      entry.status === 'failed' ? 'bg-red-400 text-red-400' :
                      'bg-amber-400/60 text-amber-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-foreground font-mono">{entry.rotation_type}</span>
                      {entry.detail && (
                        <span className="text-foreground ml-1.5 truncate">{entry.detail}</span>
                      )}
                    </div>
                    <span className="text-foreground shrink-0">
                      {formatRelativeTime(entry.created_at)}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
