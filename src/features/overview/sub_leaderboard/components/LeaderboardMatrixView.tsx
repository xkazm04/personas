import { useState, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ExternalLink, Info, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { rankBy, RANK_OPTIONS, type RankKey } from '../libs/leaderboardRanking';
import type { LeaderboardEntry, PerformanceTier } from '../libs/leaderboardScoring';
import { metricValue, fleetValue, scoreTint } from './leaderboardViewHelpers';
import type { LeaderboardViewProps } from './leaderboardViewTypes';

// Prototype-local copy — extracted to en.json at consolidation.
const COPY = {
  rank: '#',
  agent: 'Agent',
  fleetAvg: 'Fleet avg',
  sortHint: 'Click a metric to sort',
  tied: 'tied',
  speedCaveat:
    'Identical for every agent — latency is mapped fleet-wide, not per-agent (known bug). This column can’t differentiate until per-persona latency is plumbed through.',
};

const TIER_LABEL: Record<PerformanceTier, string> = {
  elite: 'Elite',
  strong: 'Strong',
  average: 'Average',
  developing: 'Developing',
};

const MEDAL_STYLE: Record<string, string> = {
  gold: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  silver: 'bg-slate-300/15 border-slate-400/30 text-slate-200',
  bronze: 'bg-orange-600/15 border-orange-600/30 text-orange-300',
};

const LEGEND = [
  { label: '80+', dot: 'bg-emerald-500' },
  { label: '60+', dot: 'bg-blue-500' },
  { label: '40+', dot: 'bg-amber-500' },
  { label: '<40', dot: 'bg-red-500' },
];

/** ≤1 decimal, trailing .0 stripped. */
const d1 = (n: number) => String(Math.round(n * 10) / 10);

function gradeWord(score: number): string {
  if (score >= 80) return 'Healthy';
  if (score >= 50) return 'Degraded';
  if (score > 0) return 'Critical';
  return '—';
}

/** Mirrors leaderboardScoring's per-exec cost so the raw matches the score. */
function costPerExec(e: LeaderboardEntry): number {
  return e.totalExecutions > 0 ? e.dailyBurnRate / Math.max(1, e.recentExecutions / 7) : 0;
}

/** Secondary value shown under the score — a measurement where it adds signal
 *  (success %, latency, $/run, runs/7d), a qualitative grade where the raw
 *  would just echo the score (overall → tier, health → grade). ≤1 decimal. */
function subLabel(entry: LeaderboardEntry, key: RankKey): string {
  switch (key) {
    case 'overall': return TIER_LABEL[entry.tier];
    case 'success': return `${d1(entry.successRate)}%`;
    case 'health': return gradeWord(metricValue(entry, 'health'));
    case 'speed': return entry.avgLatencyMs > 0 ? `${d1(entry.avgLatencyMs / 1000)}s` : '—';
    case 'cost': {
      const c = costPerExec(entry);
      return c <= 0 ? '—' : c < 0.1 ? '<$0.1' : `$${d1(c)}`;
    }
    case 'activity': return `${entry.recentExecutions}/7d`;
    default: return '';
  }
}

/**
 * Scorecard matrix: one row per persona, one column per metric. Every cell
 * carries the normalized 0-100 score (heatmap-tinted, with a within-tier
 * magnitude bar) over a ≤1-decimal raw measurement, so the whole fleet is
 * comparable at a glance. Columns are sortable; a dashed fleet-average row
 * anchors the bottom as a benchmark.
 */
export function LeaderboardMatrixView({
  leaderboard,
  fleetAvgScore,
  fleetBenchmark,
  onNavigateToAgent,
}: LeaderboardViewProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const lb = t.overview.leaderboard;
  const [sortKey, setSortKey] = useState<RankKey>('overall');

  const rows = useMemo(() => rankBy(leaderboard, sortKey), [leaderboard, sortKey]);

  // Surface the known latency-mapping gap: if every agent has the same speed
  // score, the column is non-differentiating and we flag it inline.
  const speedAllEqual = useMemo(() => {
    const vals = new Set(leaderboard.map((e) => metricValue(e, 'speed')));
    return leaderboard.length > 1 && vals.size === 1;
  }, [leaderboard]);

  return (
    <div className="max-w-5xl mx-auto w-full">
      {/* Heatmap legend + sort hint */}
      <div className="flex items-center justify-between gap-3 mb-2.5 px-1">
        <div className="flex items-center gap-3">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1 typo-caption text-foreground">
              <span className={`w-2 h-2 rounded-full ${l.dot}`} aria-hidden />
              <span className="tabular-nums">{l.label}</span>
            </span>
          ))}
        </div>
        <span className="typo-caption text-foreground">{COPY.sortHint}</span>
      </div>

      <div className="overflow-x-auto rounded-modal border border-primary/[0.08] bg-secondary/[0.03] shadow-elevation-1">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr className="bg-primary/[0.03]">
              <th className="w-12 px-2 py-3 text-center typo-caption font-semibold text-foreground">{COPY.rank}</th>
              <th className="px-3 py-3 text-left typo-caption font-semibold text-foreground">{COPY.agent}</th>
              {RANK_OPTIONS.map((opt) => {
                const active = sortKey === opt.key;
                const flagged = opt.key === 'speed' && speedAllEqual;
                const headline = opt.key === 'overall';
                return (
                  <th key={opt.key} className={`px-2 py-2 align-bottom ${headline ? 'border-r border-primary/10' : ''}`}>
                    <button
                      onClick={() => setSortKey(opt.key)}
                      className={`mx-auto flex items-center justify-center gap-0.5 typo-caption font-semibold transition-colors ${active ? 'text-primary' : 'text-foreground hover:text-primary/80'}`}
                    >
                      {lb[opt.labelKey]}
                      <ChevronDown className={`w-3 h-3 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
                    </button>
                    <div className={`mx-auto mt-1 h-0.5 w-6 rounded-full transition-colors ${active ? 'bg-primary' : 'bg-transparent'}`} />
                    {flagged && (
                      <span title={COPY.speedCaveat} className="mt-0.5 flex items-center justify-center gap-1 typo-caption text-amber-400 cursor-help">
                        <Info className="w-3 h-3 flex-shrink-0" aria-hidden />
                        <span className="leading-none">{COPY.tied}</span>
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, idx) => (
              <motion.tr
                key={entry.personaId}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reduce ? 0 : 0.22, delay: reduce ? 0 : idx * 0.025 }}
                className="hover:bg-primary/[0.03] transition-colors"
              >
                <td className="px-2 py-2 text-center align-middle border-t border-primary/[0.06]">
                  {entry.medal ? (
                    <span className={`inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 rounded-card border typo-caption font-bold tabular-nums ${MEDAL_STYLE[entry.medal]}`}>
                      {entry.rank}
                    </span>
                  ) : (
                    <span className="typo-caption text-foreground tabular-nums">{entry.rank}</span>
                  )}
                </td>
                <td className="px-3 py-2 align-middle border-t border-primary/[0.06]">
                  <button
                    onClick={() => onNavigateToAgent(entry.personaId)}
                    className="group/agent flex items-center gap-2.5 min-w-0 text-left"
                  >
                    <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} name={entry.personaName} display="pop" frameSize="sm" />
                    <span className="typo-body font-medium text-foreground truncate group-hover/agent:text-primary transition-colors">{entry.personaName}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover/agent:opacity-100 text-primary/70 transition-opacity" />
                  </button>
                </td>
                {RANK_OPTIONS.map((opt) => (
                  <MetricCell
                    key={opt.key}
                    value={metricValue(entry, opt.key)}
                    sub={subLabel(entry, opt.key)}
                    emphasized={sortKey === opt.key}
                    headline={opt.key === 'overall'}
                  />
                ))}
              </motion.tr>
            ))}

            {/* Fleet-average reference row */}
            <tr className="bg-primary/[0.02]">
              <td className="border-t-2 border-dashed border-primary/20" />
              <td className="px-3 py-2.5 align-middle border-t-2 border-dashed border-primary/20">
                <span className="typo-caption font-semibold text-foreground uppercase tracking-wide">{COPY.fleetAvg}</span>
              </td>
              {RANK_OPTIONS.map((opt) => {
                const v = Math.round(fleetValue(opt.key, fleetAvgScore, fleetBenchmark));
                const tint = scoreTint(v);
                return (
                  <td key={opt.key} className={`px-2 py-2.5 text-center border-t-2 border-dashed border-primary/20 ${opt.key === 'overall' ? 'border-r border-primary/10' : ''}`}>
                    <span className={`typo-body font-mono font-semibold tabular-nums ${tint.text}`}>{v}</span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCell({ value, sub, emphasized, headline }: { value: number; sub: string; emphasized?: boolean; headline?: boolean }) {
  const tint = scoreTint(value);
  return (
    <td className={`px-1.5 py-1.5 align-middle border-t border-primary/[0.06] ${headline ? 'border-r border-primary/10' : ''}`}>
      <div className={`relative rounded-card px-2 pt-1.5 pb-2 text-center overflow-hidden ${tint.bg} ${emphasized ? 'ring-1 ring-primary/40' : ''}`}>
        <div className={`${headline ? 'typo-heading' : 'typo-body'} font-bold tabular-nums leading-tight ${tint.text}`}>{value}</div>
        <div className="typo-caption tabular-nums leading-tight truncate">{sub}</div>
        <span
          aria-hidden
          className="absolute left-0 bottom-0 h-0.5 rounded-full opacity-60"
          style={{ width: `${value}%`, backgroundColor: tint.hex }}
        />
      </div>
    </td>
  );
}
