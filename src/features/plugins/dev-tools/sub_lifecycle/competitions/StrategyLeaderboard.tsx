import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getStrategyLeaderboard } from '@/api/devTools/devTools';
import { createLatestWins } from '@/stores/util/latestWins';
import type { DevStrategyStats } from '@/lib/bindings/DevStrategyStats';
import { silentCatch } from '@/lib/silentCatch';

// ---------------------------------------------------------------------------
// Statistical honesty for the ranking.
//
// `get_strategy_leaderboard` orders `wins DESC, total DESC` and this panel
// renders that order top-down with a win-rate percentage — i.e. it PRESENTS AN
// ORDERING AS A CONCLUSION. A conclusion needs evidence, and a competition
// project typically has one to three resolved races, so "80% win rate" is
// routinely 4 wins out of 5, or 1 out of 1. Nothing below changes the ordering
// (that is the backend's call); it attaches the uncertainty the order was
// being read without.
//
// Wilson score interval rather than the normal approximation: the normal
// interval degenerates at exactly the sample sizes this panel actually sees
// (p̂ = 0 or 1 gives a zero-width interval, which would claim CERTAINTY from
// one race — the opposite of the point).
// ---------------------------------------------------------------------------

/** Below this many resolved competitions a rate is a curiosity, not a measurement. */
export const MIN_RANKABLE_SAMPLE = 5;

const Z_95 = 1.959964;

export interface WinRateInterval {
  /** Lower bound of the 95% Wilson interval, 0..1. */
  low: number;
  /** Upper bound of the 95% Wilson interval, 0..1. */
  high: number;
}

/** 95% Wilson score interval for `wins` successes out of `total` trials. */
export function wilsonInterval(wins: number, total: number): WinRateInterval {
  // No trials means no information — the honest interval is the whole range.
  if (total <= 0) return { low: 0, high: 1 };
  const p = Math.min(1, Math.max(0, wins / total));
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const margin = (Z_95 / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/**
 * Is the leaderboard's headline claim — "#1 beats #2" — actually supported?
 * True only when the leader's lower bound clears the runner-up's upper bound.
 * A single row is trivially "separated": there is no comparison being made.
 */
export function isTopOrderingSeparated(stats: { wins: number; total: number }[]): boolean {
  if (stats.length < 2) return true;
  const first = wilsonInterval(stats[0]!.wins, stats[0]!.total);
  const second = wilsonInterval(stats[1]!.wins, stats[1]!.total);
  return first.low > second.high;
}

export function StrategyLeaderboard({ projectId }: { projectId: string }) {
  const { t, tx } = useTranslation();
  const [stats, setStats] = useState<DevStrategyStats[]>([]);
  const [loading, setLoading] = useState(false);

  // Latest-wins guard. This panel refetches on every project switch and on
  // every Refresh click, so two flights can be open at once; without a token
  // the SLOWER one wins simply by landing last, and project A's leaderboard
  // paints under project B's header. A monotonic counter (never a timestamp —
  // it collides under rapid dispatch, exactly when the guard matters) is
  // minted synchronously BEFORE the request leaves, and both the success and
  // the failure path check it. A stale completion is inert, not an error.
  const requestGuard = useRef(createLatestWins()).current;

  const load = useCallback(async () => {
    const token = requestGuard.next();
    setLoading(true);
    try {
      const data = await getStrategyLeaderboard(projectId);
      if (!requestGuard.isCurrent(token)) return;
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
      if (requestGuard.isCurrent(token)) setLoading(false);
    }
  }, [projectId, requestGuard]);

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
  const orderingSeparated = isTopOrderingSeparated(stats);

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
        {stats.map((s) => {
          const ci = wilsonInterval(s.wins, s.total);
          const lowSample = s.total < MIN_RANKABLE_SAMPLE;
          return (
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
            {/* The rate carries its own interval. A bare "80%" over five races
                reads as a measurement; the tooltip is where the width of that
                claim actually lives. Shared Tooltip, not `title=` — the native
                attribute is hover-only, keyboard-unreachable and invisible on
                touch (docs/concepts/golden-paths/tooltip.md). */}
            <Tooltip
              content={tx(t.plugins.dev_lifecycle.leaderboard_ci_title, {
                low: Math.round(ci.low * 100),
                high: Math.round(ci.high * 100),
              })}
            >
              <span className={`typo-caption w-12 text-right shrink-0 tabular-nums ${lowSample ? 'text-foreground/60' : 'text-foreground'}`}>
                {Math.round(s.win_rate * 100)}%
              </span>
            </Tooltip>
            {lowSample && (
              <Tooltip content={tx(t.plugins.dev_lifecycle.leaderboard_low_sample_title, { n: s.total })}>
                <span className="typo-caption text-amber-400/80 shrink-0">
                  {t.plugins.dev_lifecycle.leaderboard_low_sample}
                </span>
              </Tooltip>
            )}
            {s.disqualified_count > 0 && (
              <span className="typo-caption text-amber-400 shrink-0" title={t.plugins.dev_lifecycle.dq_title}>
                {t.plugins.dev_lifecycle.dq_label}{s.disqualified_count}
              </span>
            )}
          </div>
          );
        })}
      </div>
      {!orderingSeparated && (
        <p className="typo-caption text-amber-400/80 mt-3">
          {t.plugins.dev_lifecycle.leaderboard_not_separated}
        </p>
      )}
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
