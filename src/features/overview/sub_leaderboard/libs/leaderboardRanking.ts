/**
 * Leaderboard ranking — re-order the board by any single score dimension.
 *
 * `computeLeaderboard` ranks by the composite score; this lets the user pivot
 * the same data to ask "who's fastest / cheapest / most reliable" without
 * recomputing scores. Pure, presentation-only: it reorders + re-numbers +
 * re-medals existing entries, it never mutates the underlying dimension data.
 */

import { dimensionValue, medalFor, type LeaderboardEntry, type DimensionKey } from './leaderboardScoring';

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

/**
 * Re-rank entries by the chosen key. `'overall'` returns the input untouched
 * (it is already composite-sorted). For a dimension key, entries measured on
 * that dimension are sorted by its normalized value (composite as the
 * tiebreaker) and re-ranked and re-medalled; entries NOT measured on it follow,
 * unranked, so an absence never takes a medal.
 */
export function rankBy(entries: LeaderboardEntry[], key: RankKey): LeaderboardEntry[] {
  if (key === 'overall') return entries;
  const value = (e: LeaderboardEntry) => dimensionValue(e, key) ?? -1;
  const sorted = [...entries].sort(
    (a, b) => value(b) - value(a) || (b.compositeScore ?? -1) - (a.compositeScore ?? -1),
  );
  return sorted.map((entry, i) => {
    const rank = dimensionValue(entry, key) === null ? null : i + 1;
    return { ...entry, rank, medal: medalFor(rank) };
  });
}
