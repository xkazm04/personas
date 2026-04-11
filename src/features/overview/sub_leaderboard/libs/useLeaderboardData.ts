import { useMemo } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { computeLeaderboard, type LeaderboardEntry } from './leaderboardScoring';

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

  return {
    leaderboard,
    loading: healthLoading,
    isEmpty: healthSignals.length === 0,
    fleetAvgScore,
    refresh: refreshHealthDashboard,
  };
}

export type { LeaderboardEntry };
