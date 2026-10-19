import { useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { computeLeaderboard, type LeaderboardEntry } from './leaderboardScoring';

/** Fleet-wide averages used as a benchmark to contextualize a single agent.
 *  `dimensionValues` is aligned to `LeaderboardEntry.dimensions` order; each
 *  slot averages only the agents measured on that dimension (null if none). */
export interface FleetBenchmark {
  dimensionValues: (number | null)[]; // [success, health, speed, cost, activity], 0-100
}

export function computeFleetBenchmark(entries: LeaderboardEntry[]): FleetBenchmark | null {
  if (entries.length === 0) return null;
  const dimCount = entries[0]!.dimensions.length;
  const dimensionValues = Array.from({ length: dimCount }, (_, i) => averageOf(
    entries.map((e) => e.dimensions[i]?.value ?? null),
  ));
  return { dimensionValues };
}

/** Rounded mean of the measured values, or null when none were measured. */
function averageOf(values: (number | null)[]): number | null {
  const measured = values.filter((v): v is number => v !== null);
  if (measured.length === 0) return null;
  return Math.round(measured.reduce((sum, v) => sum + v, 0) / measured.length);
}

export function useLeaderboardData() {
  const {
    healthSignals, healthLoading, refreshHealthDashboard,
  } = useOverviewStore(useShallow((s) => ({
    healthSignals: s.healthSignals,
    healthLoading: s.healthLoading,
    refreshHealthDashboard: s.refreshHealthDashboard,
  })));

  const leaderboard = useMemo(
    () => computeLeaderboard(healthSignals),
    [healthSignals],
  );

  // Over the ranked agents only; null when none has enough coverage to score.
  const fleetAvgScore = useMemo(
    () => averageOf(leaderboard.map((e) => e.compositeScore)),
    [leaderboard],
  );

  const fleetBenchmark = useMemo(() => computeFleetBenchmark(leaderboard), [leaderboard]);

  return {
    leaderboard,
    loading: healthLoading,
    isEmpty: healthSignals.length === 0,
    fleetAvgScore,
    fleetBenchmark,
    refresh: refreshHealthDashboard,
  };
}

export type { LeaderboardEntry };
