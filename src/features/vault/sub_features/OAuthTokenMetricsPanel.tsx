import { useEffect, useState } from 'react';
import { Timer, AlertTriangle, TrendingDown, RefreshCw, ArrowDown } from 'lucide-react';
import { getOAuthTokenLifetimeSummary, getOAuthTokenMetrics } from '@/api/vault/rotation';
import type { OAuthTokenLifetimeSummary, OAuthTokenMetric } from '@/api/vault/rotation';
import { formatDuration as _formatDuration } from '@/lib/utils/formatters';

const formatDuration = (secs: number) => _formatDuration(secs, { unit: 's' });

export function OAuthTokenMetricsPanel({ credentialId }: { credentialId: string }) {
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
      <div className="flex items-center justify-center py-6 text-muted-foreground/60 text-sm">
        <div className="w-3.5 h-3.5 border border-primary/30 border-t-transparent rounded-full animate-spin mr-2" />
        Loading metrics...
      </div>
    );
  }

  if (!summary || summary.totalRefreshes === 0) {
    return (
      <div className="text-sm text-muted-foreground/60 py-4 text-center">
        No token refresh metrics recorded yet. Metrics will appear after the first OAuth token refresh.
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Token lifetime is trending shorter — possible provider throttling or policy change.</span>
        </div>
      )}

      {/* Summary stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatBox
          label="Total Refreshes"
          value={String(summary.totalRefreshes)}
          icon={<RefreshCw className="w-3 h-3" />}
        />
        <StatBox
          label="Failure Rate"
          value={`${failureRate}%`}
          icon={<AlertTriangle className="w-3 h-3" />}
          alert={summary.failureCount > 0}
        />
        <StatBox
          label="Avg Lifetime"
          value={summary.avgPredictedLifetimeSecs != null ? formatDuration(Math.round(summary.avgPredictedLifetimeSecs)) : '—'}
          icon={<Timer className="w-3 h-3" />}
        />
        <StatBox
          label="Avg Drift"
          value={summary.avgDriftSecs != null ? `${summary.avgDriftSecs > 0 ? '+' : ''}${formatDuration(Math.round(Math.abs(summary.avgDriftSecs)))}` : '—'}
          icon={<TrendingDown className="w-3 h-3" />}
          alert={summary.avgDriftSecs != null && summary.avgDriftSecs < -300}
        />
      </div>

      {/* Fallback usage */}
      {summary.fallbackCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground/80 px-1">
          <ArrowDown className="w-3 h-3 text-amber-400" />
          <span>
            Fallback (3600s) used in <span className="font-mono tabular-nums text-amber-400">{fallbackRate}%</span> of
            refreshes ({summary.fallbackCount}/{summary.totalRefreshes}) — provider omits <code className="text-sm font-mono bg-secondary/40 px-1 rounded">expires_in</code>
          </span>
        </div>
      )}

      {/* Lifetime trend sparkline */}
      {summary.recentPredictedLifetimes.length >= 2 && (
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground/60">Recent provider TTLs (newest first)</span>
          <div className="flex items-end gap-1 h-8">
            {summary.recentPredictedLifetimes.map((secs, i) => {
              const max = Math.max(...summary.recentPredictedLifetimes);
              const pct = max > 0 ? (secs / max) * 100 : 0;
              const isDecreasing = i > 0 && secs < summary.recentPredictedLifetimes[i - 1]!;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-sm transition-all ${isDecreasing ? 'bg-amber-400/60' : 'bg-emerald-400/40'}`}
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
          <span className="text-sm text-muted-foreground/60">Recent refreshes</span>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {recentMetrics.slice(0, 5).map((m) => (
              <div
                key={m.id}
                className={`flex items-center justify-between text-sm px-2 py-1 rounded-lg ${
                  m.success
                    ? 'bg-secondary/20 text-foreground/80'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}
              >
                <span className="font-mono text-muted-foreground/60 text-xs">
                  {new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <div className="flex items-center gap-2">
                  {m.usedFallback && (
                    <span className="text-xs bg-amber-500/10 text-amber-400 px-1 rounded">fallback</span>
                  )}
                  {m.predictedLifetimeSecs != null && (
                    <span className="font-mono tabular-nums text-xs">{formatDuration(m.predictedLifetimeSecs)}</span>
                  )}
                  {m.driftSecs != null && (
                    <span className={`font-mono tabular-nums text-xs ${m.driftSecs < -60 ? 'text-amber-400' : 'text-muted-foreground/60'}`}>
                      ({m.driftSecs > 0 ? '+' : ''}{formatDuration(Math.abs(m.driftSecs))})
                    </span>
                  )}
                  {!m.success && m.errorMessage && (
                    <span className="text-xs truncate max-w-[120px]" title={m.errorMessage}>{m.errorMessage}</span>
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
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
      alert ? 'bg-amber-500/10 border-amber-500/20' : 'bg-secondary/20 border-primary/8'
    }`}>
      <div className={alert ? 'text-amber-400' : 'text-muted-foreground/60'}>{icon}</div>
      <div>
        <div className={`text-sm font-mono tabular-nums ${alert ? 'text-amber-400' : 'text-foreground/90'}`}>{value}</div>
        <div className="text-xs text-muted-foreground/50">{label}</div>
      </div>
    </div>
  );
}
