import { Trophy, Users } from 'lucide-react';
import type { LeaderboardEntry } from '../libs/leaderboardScoring';
import { ScoreRadar } from './ScoreRadar';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Trophy className="w-10 h-10 text-foreground" />
      <p className="typo-body font-medium text-foreground">No agent data yet</p>
      <p className="typo-caption text-foreground max-w-sm text-center">
        Run some agents to see performance rankings. The leaderboard needs execution
        history and health data to compute scores.
      </p>
    </div>
  );
}

export function SingleAgentView({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="max-w-2xl mx-auto flex flex-col items-center gap-4 py-8">
      <Users className="w-8 h-8 text-foreground" />
      <p className="typo-body text-foreground text-center">
        Add more agents to see rankings. Currently only{' '}
        <strong className="text-foreground">{entry.personaName}</strong> has data.
      </p>
      <div className="flex justify-center">
        <ScoreRadar entries={[entry]} size={220} />
      </div>
    </div>
  );
}
