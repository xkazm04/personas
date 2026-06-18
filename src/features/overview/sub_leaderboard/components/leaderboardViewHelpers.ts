/**
 * Shared metric accessors + the canonical 0-100 heatmap scale used by the
 * Matrix view. The 80 / 60 / 40 thresholds match the score colouring used
 * across the leaderboard so cells and bars read the same colour for the same
 * score.
 */

import type { LeaderboardEntry } from '../libs/leaderboardScoring';
import type { RankKey } from '../libs/leaderboardRanking';
import type { FleetBenchmark } from '../libs/useLeaderboardData';

/** Dimension order as emitted by computeLeaderboard — kept aligned with
 *  FleetBenchmark.dimensionValues so a key maps to the right benchmark slot. */
const DIM_ORDER = ['success', 'health', 'speed', 'cost', 'activity'] as const;

/** Normalized 0-100 value for any rankable metric (overall = composite). */
export function metricValue(entry: LeaderboardEntry, key: RankKey): number {
  if (key === 'overall') return entry.compositeScore;
  return entry.dimensions.find((d) => d.key === key)?.value ?? 0;
}

/** Fleet-average normalized value for a metric, for the benchmark reference. */
export function fleetValue(
  key: RankKey,
  fleetAvgScore: number,
  benchmark: FleetBenchmark | null,
): number {
  if (key === 'overall') return fleetAvgScore;
  const idx = DIM_ORDER.indexOf(key as (typeof DIM_ORDER)[number]);
  return benchmark?.dimensionValues[idx] ?? 0;
}

export interface ScoreTint {
  /** subtle cell/background tint */
  bg: string;
  /** value text colour */
  text: string;
  /** raw hex for SVG / inline styles (dots, rings) */
  hex: string;
}

export function scoreTint(v: number): ScoreTint {
  if (v >= 80) return { bg: 'bg-emerald-500/15', text: 'text-emerald-400', hex: '#10B981' };
  if (v >= 60) return { bg: 'bg-blue-500/15', text: 'text-blue-400', hex: '#3B82F6' };
  if (v >= 40) return { bg: 'bg-amber-500/15', text: 'text-amber-400', hex: '#F59E0B' };
  return { bg: 'bg-red-500/15', text: 'text-red-400', hex: '#EF4444' };
}
