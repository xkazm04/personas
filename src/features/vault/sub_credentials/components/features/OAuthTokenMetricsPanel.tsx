import { useEffect, useState } from 'react';
import { Timer, AlertTriangle, TrendingDown, RefreshCw, ArrowDown } from 'lucide-react';
import { getOAuthTokenLifetimeSummary, getOAuthTokenMetrics } from '@/api/vault/rotation';
import type { OAuthTokenLifetimeSummary, OAuthTokenMetric } from '@/api/vault/rotation';
import { formatDuration as _formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

const formatDuration = (secs: number) => _formatDuration(secs, { unit: 's' });

export function OAuthTokenMetricsPanel({ credentialId }: { credentialId: string }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<OAuthTokenLifetimeSummary | null>(null);
  const [recentMetrics, setRecentMetrics] = useState<OAuthTokenMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getOAuthTokenLifetimeSummary(credentialId),
      getOAuthTokenMetrics(credentialId, 10),
    ])
      .then(([s, m]) => {
        if (!cancelled) {
          setSummary(s);
          setRecentMetrics(m);
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [credentialId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-foreground typo-body">
        <div className="w-3.5 h-3.5 border border-primary/30 border-t-transparent rounded-full animate-spin mr-2" />
        {t.vault.token_metrics.loading}
      </div>
    );
  }

  if (!summary || summary.totalRefreshes === 0) {
    return (
      <div className="typo-body text-foreground py-4 text-center">
        {t.vault.token_metrics.no_metrics}
      </div>
    );
  }

  const failureRate = summary.totalRefreshes > 0
    ? ((summary.failureCount / summary.totalRefreshes) * 100).toFixed(1)
    : '0';

  const fallbackRate = summary.totalRefreshes > 0
    ? ((summary.fallbackCount / summary.totalRefreshes) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-3">
      {/* Trend warning */}
      {summary.lifetimeTrendingShorter && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-modal bg-amber-500/10 border border-amber-500/20 text-amber-400 typo-body">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{t.vault.token_metrics.trend_warning}</span>
        </div>
      )}

      {/* Summary stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatBox
          label={t.vault.token_metrics.total_refreshes}
          value={String(summary.totalRefreshes)}
          icon={<RefreshCw className="w-3 h-3" />}
        />
        <StatBox
          label={t.vault.token_metrics.failure_rate}
          value={`${failureRate}%`}
          icon={<AlertTriangle className="w-3 h-3" />}
          alert={summary.failureCount > 0}
        />
        <StatBox
          label={t.vault.token_metrics.avg_lifetime}
          value={summary.avgPredictedLifetimeSecs != null ? formatDuration(Math.round(summary.avgPredictedLifetimeSecs)) : '—'}
          icon={<Timer className="w-3 h-3" />}
        />
        <StatBox
          label={t.vault.token_metrics.avg_drift}
          value={summary.avgDriftSecs != null ? `${summary.avgDriftSecs > 0 ? '+' : ''}${formatDuration(Math.round(Math.abs(summary.avgDriftSecs)))}` : '—'}
          icon={<TrendingDown className="w-3 h-3" />}
          alert={summary.avgDriftSecs != null && summary.avgDriftSecs < -300}
        />
      </div>

      {/* Fallback usage */}
      {summary.fallbackCount > 0 && (
        <div className="flex items-center gap-2 typo-body text-foreground px-1">
          <ArrowDown className="w-3 h-3 text-amber-400" />
          <span>
            Fallback (3600s) used in <span className="font-mono tabular-nums text-amber-400">{fallbackRate}%</span> of
            refreshes ({summary.fallbackCount}/{summary.totalRefreshes}) — provider omits <code className="typo-code font-mono bg-secondary/40 px-1 rounded">expires_in</code>
          </span>
        </div>
      )}

      {/* Lifetime trend sparkline */}
      {summary.recentPredictedLifetimes.length >= 2 && (
        <div className="space-y-1">
          <span className="typo-body text-foreground">{t.vault.token_metrics.recent_ttls}</span>
          <div className="flex items-end gap-1 h-8">
            {summary.recentPredictedLifetimes.map((secs, i) => {
              const max = Math.max(...summary.recentPredictedLifetimes);
              const pct = max > 0 ? (secs / max) * 100 : 0;
              const isDecreasing = i > 0 && secs < summary.recentPredictedLifetimes[i - 1]!;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-interactive transition-all ${isDecreasing ? 'bg-amber-400/60' : 'bg-emerald-400/40'}`}
                  style={{ height: `${Math.max(pct, 8)}%` }}
                  title={`${formatDuration(secs)} (${secs}s)`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Recent refresh history */}
      {recentMetrics.length > 0 && (
        <div className="space-y-1">
          <span className="typo-body text-foreground">{t.vault.token_metrics.recent_refreshes}</span>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {recentMetrics.slice(0, 5).map((m) => (
              <div
                key={m.id}
                className={`flex items-center justify-between typo-body px-2 py-1 rounded-card ${
                  m.success
                    ? 'bg-secondary/20 text-foreground'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}
              >
                <span className="font-mono text-foreground typo-code">
                  {new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <div className="flex items-center gap-2">
                  {m.usedFallback && (
                    <span className="typo-caption bg-amber-500/10 text-amber-400 px-1 rounded">fallback</span>
                  )}
                  {m.predictedLifetimeSecs != null && (
                    <span className="font-mono tabular-nums typo-code">{formatDuration(m.predictedLifetimeSecs)}</span>
                  )}
                  {m.driftSecs != null && (
                    <span className={`font-mono tabular-nums typo-code ${m.driftSecs < -60 ? 'text-amber-400' : 'text-foreground'}`}>
                      ({m.driftSecs > 0 ? '+' : ''}{formatDuration(Math.abs(m.driftSecs))})
                    </span>
                  )}
                  {!m.success && m.errorMessage && (
                    <span className="typo-caption truncate max-w-[120px]" title={m.errorMessage}>{m.errorMessage}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, icon, alert }: { label: string; value: string; icon: React.ReactNode; alert?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-modal border ${
      alert ? 'bg-amber-500/10 border-amber-500/20' : 'bg-secondary/20 border-primary/8'
    }`}>
      <div className={alert ? 'text-amber-400' : 'text-foreground'}>{icon}</div>
      <div>
        <div className={`typo-code font-mono tabular-nums ${alert ? 'text-amber-400' : 'text-foreground/90'}`}>{value}</div>
        <div className="typo-caption text-foreground">{label}</div>
      </div>
    </div>
  );
}
