import type { LeaderboardEntry } from '../libs/leaderboardScoring';
import type { FleetBenchmark } from '../libs/useLeaderboardData';

/**
 * Prop contract for the leaderboard Matrix view. The page wrapper owns the data
 * hook + navigation handler and passes this shape down; the view manages only
 * its own internal sort state.
 */
export interface LeaderboardViewProps {
  leaderboard: LeaderboardEntry[];
  fleetBenchmark: FleetBenchmark | null;
  fleetAvgScore: number;
  onNavigateToAgent: (personaId: string) => void;
}
