import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ExternalLink, Target, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { LeaderboardEntry, DimensionKey } from '../libs/leaderboardScoring';
import type { FleetBenchmark } from '../libs/useLeaderboardData';
import { biggestOpportunity } from '../libs/leaderboardRanking';
import { ScoreRadar } from './ScoreRadar';
import { DebtText } from '@/i18n/DebtText';


interface DetailPanelProps {
  entry: LeaderboardEntry | null;
  onNavigateToAgent: (personaId: string) => void;
  /** Jump to the agent's Lab/Improve flow — wired from the opportunity CTA. */
  onImproveAgent?: (personaId: string) => void;
  /** Fleet-wide averages, used to benchmark this agent on the radar + stats. */
  fleetBenchmark?: FleetBenchmark | null;
  /** When true (an agent is explicitly selected), echo the selection with a
   *  primary ring so the panel reads as linked to the highlighted row. */
  highlighted?: boolean;
}

interface StatDelta {
  text: string;
  good: boolean;
}

/** Signed difference of `agent` vs the fleet `fleet`, coloured by whether the
 *  direction is favourable. Returns null when there's nothing to compare. */
function buildDelta(
  agent: number,
  fleet: number | undefined,
  higherIsBetter: boolean,
  fmt: (n: number) => string,
): StatDelta | null {
  if (fleet === undefined || !Number.isFinite(fleet)) return null;
  const diff = agent - fleet;
  if (Math.abs(diff) < 1e-9) return null;
  const good = higherIsBetter ? diff > 0 : diff < 0;
  const sign = diff > 0 ? '+' : '−';
  return { text: `${sign}${fmt(Math.abs(diff))}`, good };
}

export function DetailPanel({ entry, onNavigateToAgent, onImproveAgent, fleetBenchmark, highlighted }: DetailPanelProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  if (!entry) {
    return (
      <div className="p-4 rounded-modal border border-primary/[0.08] bg-secondary/[0.03]">
        <p className="typo-body text-foreground text-center"><DebtText k="auto_no_agent_selected_fa58d163" /></p>
      </div>
    );
  }

  const lb = t.overview.leaderboard;
  const showBenchmark = !!fleetBenchmark;
  const opportunity = biggestOpportunity(entry);
  const DIM_LABEL: Record<DimensionKey, string> = {
    success: lb.dim_success,
    health: lb.dim_health,
    speed: lb.dim_speed,
    cost: lb.dim_cost,
    activity: lb.dim_activity,
  };
  const DIM_HINT: Record<DimensionKey, string> = {
    success: lb.hint_success,
    health: lb.hint_health,
    speed: lb.hint_speed,
    cost: lb.hint_cost,
    activity: lb.hint_activity,
  };

  return (
    <div className={`p-4 rounded-modal border bg-secondary/[0.03] overflow-hidden transition-all duration-300 ${highlighted ? 'border-primary/30 ring-1 ring-primary/20' : 'border-primary/[0.08]'}`}>
      <AnimatePresence mode="wait">
        <motion.div
          key={entry.personaId}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <h4 className="typo-heading font-semibold text-foreground mb-3 text-center truncate">
            {entry.personaName}
          </h4>
          <div className="flex justify-center">
            <ScoreRadar entries={[entry]} size={200} benchmarkValues={fleetBenchmark?.dimensionValues} />
          </div>

          {showBenchmark && (
            <div className="mt-1 flex items-center justify-center gap-4 typo-caption text-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: '#8b5cf6' }} />
                {lb.this_agent}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 border-t border-dashed border-foreground/50" />
                {lb.fleet_average}
              </span>
            </div>
          )}

          <div className="mt-4 space-y-2">
            <StatRow
              label={lb.stat_total_runs}
              value={String(entry.totalExecutions)}
              delta={showBenchmark ? buildDelta(entry.totalExecutions, fleetBenchmark?.totalExecutions, true, (n) => String(Math.round(n))) : null}
            />
            <StatRow
              label={lb.stat_recent_7d}
              value={String(entry.recentExecutions)}
              delta={showBenchmark ? buildDelta(entry.recentExecutions, fleetBenchmark?.recentExecutions, true, (n) => String(Math.round(n))) : null}
            />
            <StatRow
              label={lb.dim_success}
              value={`${entry.successRate.toFixed(1)}%`}
              delta={showBenchmark ? buildDelta(entry.successRate, fleetBenchmark?.successRate, true, (n) => `${n.toFixed(1)}%`) : null}
            />
            <StatRow
              label={lb.stat_avg_latency}
              value={entry.avgLatencyMs > 0 ? `${(entry.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
              delta={showBenchmark && entry.avgLatencyMs > 0 ? buildDelta(entry.avgLatencyMs, fleetBenchmark?.avgLatencyMs, false, (n) => `${(n / 1000).toFixed(1)}s`) : null}
            />
            <StatRow
              label={lb.stat_daily_burn}
              value={entry.dailyBurnRate > 0 ? `$${entry.dailyBurnRate.toFixed(3)}` : '—'}
              delta={showBenchmark && entry.dailyBurnRate > 0 ? buildDelta(entry.dailyBurnRate, fleetBenchmark?.dailyBurnRate, false, (n) => `$${n.toFixed(3)}`) : null}
            />
          </div>

          {opportunity && (
            <div className="mt-4 p-3 rounded-card border border-amber-500/25 bg-amber-500/[0.06]">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span className="typo-caption font-semibold text-amber-300">{lb.biggest_opportunity}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="typo-body font-semibold text-foreground truncate">{DIM_LABEL[opportunity.dim.key]}</span>
                <span className="typo-caption text-foreground tabular-nums flex-shrink-0">
                  {opportunity.dim.value}/100 · +{opportunity.potential} {lb.pts_to_gain}
                </span>
              </div>
              <p className="typo-caption text-foreground mt-1.5 leading-snug">{DIM_HINT[opportunity.dim.key]}</p>
              {onImproveAgent && (
                <button
                  onClick={() => onImproveAgent(entry.personaId)}
                  className="mt-2.5 w-full flex items-center justify-center gap-1.5 typo-caption font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/15 py-1.5 rounded-card transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  {lb.improve_agent}
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => onNavigateToAgent(entry.personaId)}
            className="mt-4 w-full flex items-center justify-center gap-1.5 typo-caption font-medium text-primary/70 hover:text-primary hover:bg-primary/5 py-1.5 rounded-card transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            <DebtText k="auto_open_agent_e247e3d5" />
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StatRow({ label, value, delta }: { label: string; value: string; delta?: StatDelta | null }) {
  return (
    <div className="flex items-center justify-between typo-body gap-2">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        {delta && (
          <span className={`typo-caption tabular-nums flex-shrink-0 ${delta.good ? 'text-emerald-400' : 'text-red-400'}`}>
            {delta.text}
          </span>
        )}
        <span className="text-foreground font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );
}
