import { Trophy, Users } from 'lucide-react';
import type { LeaderboardEntry } from '../libs/leaderboardScoring';
import { ScoreRadar } from './ScoreRadar';
import { DebtText, debtText } from '@/i18n/DebtText';
import { IllustrationEmptyState } from '@/features/overview/shared/emptyStatePrototype';


export function EmptyState() {
  return (
    <div className="flex items-center justify-center py-12">
      <IllustrationEmptyState
        motif="leaderboard"
        content={{
          icon: Trophy,
          title: debtText("auto_no_agent_data_yet_df7e33ec"),
          subtitle: debtText("auto_run_some_agents_to_see_performance_ranking_2ccc0d58"),
        }}
      />
    </div>
  );
}

export function SingleAgentView({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="max-w-2xl mx-auto flex flex-col items-center gap-4 py-8">
      <Users className="w-8 h-8 text-foreground" />
      <p className="typo-body text-foreground text-center">
        <DebtText k="auto_add_more_agents_to_see_rankings_currently__44feb4ed" />{' '}
        <strong className="text-foreground font-semibold">{entry.personaName}</strong> <DebtText k="auto_has_data_819c84f9" />
      </p>
      <div className="flex justify-center">
        <ScoreRadar entries={[entry]} size={300} />
      </div>
    </div>
  );
}
