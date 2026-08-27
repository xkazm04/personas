import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getStrategyLeaderboard } from '@/api/devTools/devTools';
import type { DevStrategyStats } from '@/lib/bindings/DevStrategyStats';
import { silentCatch } from '@/lib/silentCatch';

export function StrategyLeaderboard({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DevStrategyStats[]>([]);
  const [loading, setLoading] = useState(false);

  // Latest-wins guard. This panel refetches on every project switch and on
  // every Refresh click, so two flights can be open at once; without a token
  // the SLOWER one wins simply by landing last, and project A's leaderboard
  // paints under project B's header. A monotonic counter (never a timestamp —
  // it collides under rapid dispatch, exactly when the guard matters) is
  // minted synchronously BEFORE the request leaves, and both the success and
  // the failure path check it. A stale completion is inert, not an error.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const token = ++requestSeq.current;
    setLoading(true);
    try {
      const data = await getStrategyLeaderboard(projectId);
      if (token !== requestSeq.current) return;
      setStats(data);
    } catch (err) {
      // Leave `stats` exactly as it is. A failed refresh must not erase a
      // leaderboard already on screen (docs/design/overview-loading.md law 1):
      // the old `setStats([])` collapsed the whole panel to `null` on one
      // transient IPC error, with no way back but another manual refresh. A
      // COLD failure needs no clear — `stats` is still the initial [].
      // The old form was a bare `catch { setStats([]) }`, so this failure
      // reached no error door at all; route it to a breadcrumb now.
      silentCatch('StrategyLeaderboard:load')(err);
    } finally {
      if (token === requestSeq.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Loading choreography (docs/design/overview-loading.md): the panel has a
  // fixed placement in CompetitionList, so collapsing to `null` while
  // fetching used to jump the layout as the panel popped in/out. A calm,
  // delayed ghost (invisible for the first 120ms — a fast fetch never paints
  // it) holds the panel's geometry instead. Settled + genuinely empty stays
  // `null` — there's nothing to show a shell for.
  if (loading && stats.length === 0) return <StrategyLeaderboardGhost />;
  if (stats.length === 0) return null;

  const maxWins = Math.max(1, ...stats.map((s) => s.wins));

  return (
    <div className="rounded-card border border-primary/15 bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-amber-400" />
        <h4 className="typo-section-title">
          {t.plugins.dev_tools.strategy_leaderboard}
        </h4>
        <button
          type="button"
          onClick={load}
          className="ml-auto text-foreground hover:text-primary transition-colors"
          title={t.common.refresh}
          aria-label={t.common.refresh}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="space-y-2">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="typo-card-label w-32 shrink-0 truncate">
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
              <span className="typo-caption text-amber-400 shrink-0" title={t.plugins.dev_lifecycle.dq_title}>
                {t.plugins.dev_lifecycle.dq_label}{s.disqualified_count}
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="typo-caption text-foreground mt-3">
        {t.plugins.dev_lifecycle.leaderboard_subtitle}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StrategyLeaderboardGhost — geometry-matched placeholder for the ONLY moment
// the panel would otherwise be absent (cold fetch, nothing loaded yet).
// `animate-fade-in` behind a staggered `animationDelay` starting at 120ms —
// invisible until then, so a fast fetch never paints it. No `animate-pulse`.
// ---------------------------------------------------------------------------
const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_LABEL_WIDTHS = ['w-32', 'w-24', 'w-28'];

function StrategyLeaderboardGhost() {
  return (
    <div className="rounded-card border border-primary/15 bg-card/40 p-4" aria-hidden="true">
      <div className="flex items-center gap-2 mb-3 animate-fade-in" style={{ animationDelay: '120ms' }}>
        <span className="w-4 h-4 rounded bg-primary/[0.08]" />
        <span className={`h-3.5 w-36 ${GHOST_BAR}`} />
      </div>
      <div className="space-y-2">
        {GHOST_LABEL_WIDTHS.map((w, i) => (
          <div
            key={i}
            className="flex items-center gap-3 animate-fade-in"
            style={{ animationDelay: `${140 + i * 35}ms` }}
          >
            <span className={`h-3 ${w} shrink-0 ${GHOST_BAR}`} />
            <span className="flex-1 h-2 rounded-full bg-primary/[0.06]" />
            <span className={`h-2.5 w-12 shrink-0 ${GHOST_BAR}`} />
            <span className={`h-2.5 w-12 shrink-0 ${GHOST_BAR}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
