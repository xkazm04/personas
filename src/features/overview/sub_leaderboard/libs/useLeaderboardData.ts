import { useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { computeLeaderboard, type LeaderboardEntry } from './leaderboardScoring';

/** Fleet-wide averages used as a benchmark to contextualize a single agent.
 *  `dimensionValues` is aligned to `LeaderboardEntry.dimensions` order. */
export interface FleetBenchmark {
  dimensionValues: number[]; // [success, health, speed, cost, activity], 0-100
}

function computeFleetBenchmark(entries: LeaderboardEntry[]): FleetBenchmark | null {
  if (entries.length === 0) return null;
  const n = entries.length;
  const dimCount = entries[0]!.dimensions.length;
  const dimensionValues = Array.from({ length: dimCount }, (_, i) =>
    Math.round(entries.reduce((sum, e) => sum + (e.dimensions[i]?.value ?? 0), 0) / n),
  );
  return { dimensionValues };
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

  const fleetAvgScore = useMemo(() => {
    if (leaderboard.length === 0) return 0;
    return Math.round(leaderboard.reduce((sum, e) => sum + e.compositeScore, 0) / leaderboard.length);
  }, [leaderboard]);

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
