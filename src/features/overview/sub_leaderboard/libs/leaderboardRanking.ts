/**
 * Leaderboard ranking — re-order the board by any single score dimension.
 *
 * `computeLeaderboard` ranks by the composite score; this lets the user pivot
 * the same data to ask "who's fastest / cheapest / most reliable" without
 * recomputing scores. Pure, presentation-only: it reorders + re-numbers +
 * re-medals existing entries, it never mutates the underlying dimension data.
 */

import type { LeaderboardEntry, Medal, DimensionKey } from './leaderboardScoring';

export type RankKey = 'overall' | DimensionKey;

/** i18n leaf key under `overview.leaderboard` for each ranking option's label. */
export interface RankOption {
  key: RankKey;
  labelKey:
    | 'dim_overall'
    | 'dim_success'
    | 'dim_health'
    | 'dim_speed'
    | 'dim_cost'
    | 'dim_activity';
}

export const RANK_OPTIONS: RankOption[] = [
  { key: 'overall', labelKey: 'dim_overall' },
  { key: 'success', labelKey: 'dim_success' },
  { key: 'health', labelKey: 'dim_health' },
  { key: 'speed', labelKey: 'dim_speed' },
  { key: 'cost', labelKey: 'dim_cost' },
  { key: 'activity', labelKey: 'dim_activity' },
];

const MEDALS = ['gold', 'silver', 'bronze'] as const;

function dimensionValue(entry: LeaderboardEntry, key: DimensionKey): number {
  return entry.dimensions.find((d) => d.key === key)?.value ?? 0;
}

/**
 * Re-rank entries by the chosen key. `'overall'` returns the input untouched
 * (it is already composite-sorted). For a dimension key, entries are sorted by
 * that dimension's normalized value (composite as the tiebreaker) and rank +
 * medal are recomputed to match the new order.
 */
export function rankBy(entries: LeaderboardEntry[], key: RankKey): LeaderboardEntry[] {
  if (key === 'overall') return entries;
  const sorted = [...entries].sort(
    (a, b) => dimensionValue(b, key) - dimensionValue(a, key) || b.compositeScore - a.compositeScore,
  );
  return sorted.map((entry, i) => ({
    ...entry,
    rank: i + 1,
    medal: (i < 3 ? MEDALS[i]! : null) as Medal,
  }));
}

/**
 * The headline number to surface for an entry under the active ranking: the
 * composite score for `'overall'`, otherwise the ranked dimension's value so
 * "1st place shows the highest number" stays true on the podium and cards.
 */
export function headlineScore(entry: LeaderboardEntry, key: RankKey): number {
  return key === 'overall' ? entry.compositeScore : dimensionValue(entry, key);
}
