import { useEffect } from 'react';
import { Users, Target } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { TeamsTab } from '@/lib/types/types';

/**
 * L2 nav for the Teams section (Teams promoted to 1st-level; Goals
 * consolidated underneath). Two entries:
 *
 * - **Workspace** — the team management table / canvas. Carries the team
 *   roster underneath (click a team to open its Studio), preserving the
 *   roster UX that previously lived inside the Agents section.
 * - **Goals** — the Goals hub (Board / Map / Timeline / Portfolio switch
 *   in-page via `GoalsPage`'s own tab strip).
 */
export function TeamsSidebarNav() {
  const { t } = useTranslation();
  const teamsTab = useSystemStore((s) => s.teamsTab);
  const setTeamsTab = useSystemStore((s) => s.setTeamsTab);
  const teams = usePipelineStore((s) => s.teams);
  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const selectTeam = usePipelineStore((s) => s.selectTeam);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  const go = (tab: TeamsTab) => {
    setTeamsTab(tab);
    useSystemStore.getState().setIsCreatingPersona(false);
  };

  return (
    <nav className="space-y-1" aria-label={t.sidebar.teams}>
      {/* Workspace header → management table (deselects any open team) */}
      <button
        data-testid="team-nav"
        onClick={() => { selectTeam(null); go('workspace'); }}
        aria-current={teamsTab === 'workspace' && !selectedTeamId ? 'page' : undefined}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
          teamsTab === 'workspace' && !selectedTeamId
            ? 'bg-primary/10 text-foreground font-semibold'
            : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
        }`}
      >
        <Users className="w-4 h-4 flex-shrink-0" />
        {t.shared.sidebar_extra.teams_label}
        {teams.length > 0 && (
          <span className="ml-auto typo-caption text-foreground/45 font-mono">{teams.length}</span>
        )}
      </button>

      {/* Team roster — click a name to open its Studio. */}
      {teams.length > 0 && (
        <div className="ml-3 pl-2 border-l border-primary/10 space-y-0.5">
          {[...teams]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((team) => (
              <button
                key={team.id}
                data-testid={`team-row-${team.id}`}
                onClick={() => { selectTeam(team.id); go('workspace'); }}
                aria-current={teamsTab === 'workspace' && selectedTeamId === team.id ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors ${
                  teamsTab === 'workspace' && selectedTeamId === team.id
                    ? 'bg-primary/10 text-foreground/90 font-medium'
                    : 'text-foreground/70 hover:bg-secondary/30 hover:text-foreground/90'
                }`}
              >
                <span
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: team.color }}
                />
                <span className="truncate">{team.name}</span>
              </button>
            ))}
        </div>
      )}

      {/* Goals hub — board/map/timeline/portfolio switch in-page */}
      <div className="mt-3 pt-3 border-t border-primary/10">
        <button
          data-testid="teams-goals-nav"
          onClick={() => go('goals')}
          aria-current={teamsTab === 'goals' ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            teamsTab === 'goals'
              ? 'bg-primary/10 text-foreground font-semibold'
              : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
          }`}
        >
          <Target className="w-4 h-4 flex-shrink-0" />
          {t.sidebar.goals}
        </button>
      </div>
    </nav>
  );
}

export default TeamsSidebarNav;
