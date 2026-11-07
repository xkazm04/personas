import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { useState, useMemo } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { ExternalLink, ChevronDown } from 'lucide-react';
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
const VISIBLE_CAP = 20;

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
              <span className="h-2.5 w-6 rounded-interactive bg-surface-2" />
            </span>
          ))}
        </div>
        <span className="h-2.5 w-24 rounded-interactive bg-surface-2" />
      </div>

      <div
        className="overflow-x-auto rounded-modal border border-hair bg-surface-1 shadow-elevation-1 animate-fade-in"
        style={{ animationDelay: '185ms' }}
      >
        <TableSkeleton columns={PLACEHOLDER_COLUMNS} rows={6} calm rowPaddingY="py-1.5" headerPaddingY="py-3" />
      </div>
    </div>
  );
}

// Rank column glyph: language-neutral, so it stays out of the catalog.
const COPY = {
  rank: '#',
};

const MEDAL_STYLE: Record<string, string> = {
  gold: 'bg-status-warning/15 border-status-warning/30 text-status-warning',
  silver: 'bg-slate-300/15 border-slate-400/30 text-ink-2',
  bronze: 'bg-status-warning/15 border-status-warning/30 text-status-warning',
};

const LEGEND = [
  { label: '80+', dot: 'bg-status-success' },
  { label: '60+', dot: 'bg-status-info' },
  { label: '40+', dot: 'bg-status-warning' },
  { label: '<40', dot: 'bg-status-error' },
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
  const notMeasured = t.overview.mission_layers.state_unmeasured;
  const [sortKey, setSortKey] = useState<RankKey>('overall');
  const [visibleCount, setVisibleCount] = useState(VISIBLE_CAP);

  const rows = useMemo(() => rankBy(leaderboard, sortKey), [leaderboard, sortKey]);
  const visibleRows = rows.slice(0, visibleCount);

  // One-shot entrance ripple (docs/design/overview-loading.md §4): each row
  // fades in with a small per-row delay the first time it appears. Entered
  // ids are remembered for the component's lifetime (no resetKey) so a
  // refresh/poll recompute delivering the same agents never replays it, and
  // re-sorting (same rows, new order) doesn't replay it either — only a
  // genuinely new persona id ripples in.
  const enter = useRevealTracker();

  return (
    <div className="max-w-5xl mx-auto w-full">
      {/* Heatmap legend + sort hint */}
      <div className="flex items-center justify-between gap-3 mb-2.5 px-1">
        <div className="flex items-center gap-3">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1 typo-caption text-ink-2">
              <span className={`w-2 h-2 rounded-full ${l.dot}`} aria-hidden />
              <span className="num">{l.label}</span>
            </span>
          ))}
        </div>
        <span className="typo-caption text-ink-2">{lb.sort_hint}</span>
      </div>

      <div className="overflow-x-auto rounded-modal border border-hair bg-surface-1 shadow-elevation-1">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr className="bg-surface-1">
              <th className="w-12 px-2 py-3 text-center typo-caption text-ink-2">{COPY.rank}</th>
              <th className="px-3 py-3 text-left typo-caption text-ink-2">{t.overview.sla_card.agent}</th>
              {RANK_OPTIONS.map((opt) => {
                const active = sortKey === opt.key;
                const headline = opt.key === 'overall';
                return (
                  <th key={opt.key} aria-sort={active ? 'descending' : undefined} className={`px-2 py-2 align-bottom ${headline ? 'border-r border-hair' : ''}`}>
                    <Button variant="ghost" size="sm" className="mx-auto" onClick={() => setSortKey(opt.key)} iconRight={<ChevronDown className={`w-3 h-3 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />}>
{lb[opt.labelKey]}
</Button>
                    <div className={`mx-auto mt-1 h-0.5 w-6 rounded-full transition-colors ${active ? 'bg-primary' : 'bg-transparent'}`} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((entry, idx) => {
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
                <td className="px-2 py-1.5 text-center align-middle border-t border-hair">
                  {entry.medal ? (
                    <span className={`inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 rounded-card border typo-data ${MEDAL_STYLE[entry.medal]}`}>
                      {entry.rank}
                    </span>
                  ) : entry.rank === null ? (
                    <Unmeasured label={notMeasured} />
                  ) : (
                    <span className="typo-data text-ink-2">{entry.rank}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 align-middle border-t border-hair">
                  <PressSurface
                    onPress={() => onNavigateToAgent(entry.personaId)}
                    className="group/agent flex items-center gap-2.5 min-w-0"
                  >
                    <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} name={entry.personaName} display="pop" frameSize="sm" />
                    <span className="typo-body text-foreground truncate group-hover/agent:text-primary transition-colors">{entry.personaName}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover/agent:opacity-100 text-primary/70 transition-opacity" />
                  </PressSurface>
                </td>
                {RANK_OPTIONS.map((opt) => (
                  <MetricCell
                    key={opt.key}
                    value={metricValue(entry, opt.key)}
                    emphasized={sortKey === opt.key}
                    headline={opt.key === 'overall'}
                    notMeasured={notMeasured}
                  />
                ))}
              </tr>
              );
            })}

            {rows.length > visibleCount && (
              <tr>
                <td colSpan={8} className="border-t border-hair px-3 py-2 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setVisibleCount((n) => n + VISIBLE_CAP)}>
                    {t.overview.activity.load_more}
                  </Button>
                </td>
              </tr>
            )}

            {/* Fleet-average reference row */}
            <tr className="bg-primary/[0.02]">
              <td className="border-t-2 border-dashed border-hair" />
              <td className="px-3 py-1.5 align-middle border-t-2 border-dashed border-hair">
                <span className="typo-eyebrow">{lb.fleet_average}</span>
              </td>
              {RANK_OPTIONS.map((opt) => {
                const v = fleetValue(opt.key, fleetAvgScore, fleetBenchmark);
                return (
                  <td key={opt.key} className={`px-2 py-1.5 text-center border-t-2 border-dashed border-hair ${opt.key === 'overall' ? 'border-r border-hair' : ''}`}>
                    {v === null ? (
                      <Unmeasured label={notMeasured} />
                    ) : (
                      <span className={`typo-data font-mono ${scoreTint(Math.round(v)).text}`}>{Math.round(v)}</span>
                    )}
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

/** An absent measurement: a dash for the eye, the words for a screen reader.
 *  Never a 0 or a neutral 50 (registry scoring-rubrics / unmeasured-honesty). */
function Unmeasured({ label }: { label: string }) {
  return (
    <span className="typo-caption text-ink-2">
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function MetricCell({ value, emphasized, headline, notMeasured }: {
  value: number | null; emphasized?: boolean; headline?: boolean; notMeasured: string;
}) {
  if (value === null) {
    return (
      <td className={`px-1.5 py-1 align-middle text-center border-t border-hair ${headline ? 'border-r border-hair' : ''}`}>
        <div className={`rounded-card px-2 py-1 ${emphasized ? 'ring-1 ring-primary/40' : ''}`}>
          <Unmeasured label={notMeasured} />
        </div>
      </td>
    );
  }
  const tint = scoreTint(value);
  return (
    <td className={`px-1.5 py-1 align-middle border-t border-hair ${headline ? 'border-r border-hair' : ''}`}>
      <div className={`relative rounded-card px-2 py-1 text-center overflow-hidden ${tint.bg} ${emphasized ? 'ring-1 ring-primary/40' : ''}`}>
        <div className={`${headline ? 'typo-data' : 'typo-body'} ${tint.text}`}>{value}</div>
        <span
          aria-hidden
          className="absolute left-0 bottom-0 h-0.5 rounded-full opacity-60"
          style={{ width: `${value}%`, backgroundColor: tint.hex }}
        />
      </div>
    </td>
  );
}
