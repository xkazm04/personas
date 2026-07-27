import { useState, useMemo } from 'react';
import { ExternalLink, Info, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { TableSkeleton, type TableSkeletonColumn } from '@/features/shared/components/layout/TableSkeleton';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { rankBy, RANK_OPTIONS, type RankKey } from '../libs/leaderboardRanking';
import { metricValue, fleetValue, scoreTint } from './leaderboardViewHelpers';
import type { LeaderboardViewProps } from './leaderboardViewTypes';

/** Per-row stagger step (ms) and the cap on how many rows stagger within the
 *  one-shot entrance ripple (docs/design/overview-loading.md §4). */
const ROW_STEP_MS = 35;
const MAX_ROW_STAGGER = 8;

// Mirrors the real matrix's columns (rank + agent + 6 metrics) so the
// placeholder's grid lands at the same geometry the content swaps into —
// no resize on reveal. Spans sum to 12.
const PLACEHOLDER_COLUMNS: TableSkeletonColumn[] = [
  { span: 'col-span-1' }, // rank
  { span: 'col-span-3', width: 'w-24' }, // agent
  { span: 'col-span-2' }, // overall
  { span: 'col-span-2' }, // success
  { span: 'col-span-1' }, // health
  { span: 'col-span-1' }, // speed
  { span: 'col-span-1' }, // cost
  { span: 'col-span-1' }, // activity
];

/**
 * Calm, content-shaped placeholder for {@link LeaderboardMatrixView} — the
 * legend strip + sortable table geometry, statically sized (no pulse).
 * Invisible for its first 150ms (`animate-fade-in` + `animationDelay`, per
 * docs/design/overview-loading.md §C) so a fast fleet-health fetch never
 * paints it at all; the swap to the real matrix is a plain conditional in
 * `LeaderboardPage`, not a cross-fade gate.
 */
export function LeaderboardMatrixPlaceholder() {
  return (
    <div className="max-w-5xl mx-auto w-full animate-fade-in" style={{ animationDelay: '150ms' }} aria-hidden="true">
      {/* Legend + sort-hint strip */}
      <div className="flex items-center justify-between gap-3 mb-2.5 px-1 animate-fade-in" style={{ animationDelay: '150ms' }}>
        <div className="flex items-center gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary/[0.08]" />
              <span className="h-2.5 w-6 rounded bg-primary/[0.06]" />
            </span>
          ))}
        </div>
        <span className="h-2.5 w-24 rounded bg-primary/[0.06]" />
      </div>

      <div
        className="overflow-x-auto rounded-modal border border-primary/[0.08] bg-secondary/[0.03] shadow-elevation-1 animate-fade-in"
        style={{ animationDelay: '185ms' }}
      >
        <TableSkeleton columns={PLACEHOLDER_COLUMNS} rows={6} calm rowPaddingY="py-1.5" headerPaddingY="py-3" />
      </div>
    </div>
  );
}

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

  // One-shot entrance ripple (docs/design/overview-loading.md §4): each row
  // fades in with a small per-row delay the first time it appears. Entered
  // ids are remembered for the component's lifetime (no resetKey) so a
  // refresh/poll recompute delivering the same agents never replays it, and
  // re-sorting (same rows, new order) doesn't replay it either — only a
  // genuinely new persona id ripples in.
  const enter = useRevealTracker();

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
                      type="button"
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
            {rows.map((entry, idx) => {
              const animate = !reduce && !enter.hasEntered(entry.personaId);
              const delay = animate ? Math.min(idx, MAX_ROW_STAGGER) * ROW_STEP_MS : 0;
              return (
              <tr
                key={entry.personaId}
                className={`hover:bg-primary/[0.03] transition-colors ${animate ? 'animate-fade-in' : ''}`}
                style={animate ? { animationDelay: `${delay}ms` } : undefined}
                onAnimationEnd={(e) => {
                  // Only our own entrance fade — ignore bubbled child animations.
                  if (e.target === e.currentTarget) enter.markEntered(entry.personaId);
                }}
              >
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  {entry.medal ? (
                    <span className={`inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 rounded-card border typo-caption font-bold tabular-nums ${MEDAL_STYLE[entry.medal]}`}>
                      {entry.rank}
                    </span>
                  ) : (
                    <span className="typo-caption text-foreground tabular-nums">{entry.rank}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 align-middle border-t border-primary/[0.06]">
                  <button
                    type="button"
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
                    emphasized={sortKey === opt.key}
                    headline={opt.key === 'overall'}
                  />
                ))}
              </tr>
              );
            })}

            {/* Fleet-average reference row */}
            <tr className="bg-primary/[0.02]">
              <td className="border-t-2 border-dashed border-primary/20" />
              <td className="px-3 py-1.5 align-middle border-t-2 border-dashed border-primary/20">
                <span className="typo-caption font-semibold text-foreground uppercase tracking-wide">{COPY.fleetAvg}</span>
              </td>
              {RANK_OPTIONS.map((opt) => {
                const v = Math.round(fleetValue(opt.key, fleetAvgScore, fleetBenchmark));
                const tint = scoreTint(v);
                return (
                  <td key={opt.key} className={`px-2 py-1.5 text-center border-t-2 border-dashed border-primary/20 ${opt.key === 'overall' ? 'border-r border-primary/10' : ''}`}>
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

function MetricCell({ value, emphasized, headline }: { value: number; emphasized?: boolean; headline?: boolean }) {
  const tint = scoreTint(value);
  return (
    <td className={`px-1.5 py-1 align-middle border-t border-primary/[0.06] ${headline ? 'border-r border-primary/10' : ''}`}>
      <div className={`relative rounded-card px-2 py-1 text-center overflow-hidden ${tint.bg} ${emphasized ? 'ring-1 ring-primary/40' : ''}`}>
        <div className={`${headline ? 'typo-heading' : 'typo-body'} font-bold tabular-nums leading-tight ${tint.text}`}>{value}</div>
        <span
          aria-hidden
          className="absolute left-0 bottom-0 h-0.5 rounded-full opacity-60"
          style={{ width: `${value}%`, backgroundColor: tint.hex }}
        />
      </div>
    </td>
  );
}
