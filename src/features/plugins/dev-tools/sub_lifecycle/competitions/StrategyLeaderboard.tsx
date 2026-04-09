import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, RefreshCw } from 'lucide-react';
import { getStrategyLeaderboard } from '@/api/devTools/devTools';
import type { DevStrategyStats } from '@/lib/bindings/DevStrategyStats';

export function StrategyLeaderboard({ projectId }: { projectId: string }) {
  const [stats, setStats] = useState<DevStrategyStats[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStrategyLeaderboard(projectId);
      setStats(data);
    } catch {
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading && stats.length === 0) return null;
  if (stats.length === 0) return null;

  const maxWins = Math.max(1, ...stats.map((s) => s.wins));

  return (
    <div className="rounded-card border border-primary/15 bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-amber-400" />
        <h4 className="typo-heading text-primary [text-shadow:_0_0_8px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
          Strategy Leaderboard
        </h4>
        <button
          onClick={load}
          className="ml-auto text-foreground hover:text-primary transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="space-y-2">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="typo-heading text-primary w-32 shrink-0 truncate [text-shadow:_0_0_8px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
              {s.label}
            </span>
            <div className="flex-1 h-2 bg-background/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all"
                style={{ width: `${(s.wins / maxWins) * 100}%` }}
              />
            </div>
            <span className="typo-caption text-foreground w-12 text-right shrink-0">
              {s.wins}/{s.total}
            </span>
            <span className="typo-caption text-foreground w-12 text-right shrink-0">
              {Math.round(s.win_rate * 100)}%
            </span>
            {s.disqualified_count > 0 && (
              <span className="typo-caption text-amber-400 shrink-0" title="Disqualified runs">
                DQ x{s.disqualified_count}
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="typo-caption text-foreground mt-3">
        Aggregated across resolved competitions. Win rate and DQ count are lifetime per strategy.
      </p>
    </div>
  );
}
