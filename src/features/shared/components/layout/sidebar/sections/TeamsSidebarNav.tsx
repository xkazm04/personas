import { useEffect } from 'react';
import { Users, Target, LayoutDashboard, Waypoints, CalendarClock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { TeamsTab, GoalsTab } from '@/lib/types/types';

/**
 * L2 nav for the Teams section (Teams promoted to 1st-level; Goals
 * consolidated underneath). Two entries:
 *
 * - **Workspace** — the team management table / canvas. Carries the team
 *   roster underneath (click a team to open its Studio), preserving the
 *   roster UX that previously lived inside the Agents section.
 * - **Goals** — the Goals hub, with its view submenu (Board / Map / Timeline)
 *   nested underneath, mirroring the team-roster indent pattern.
 */
const GOAL_VIEWS: Array<{ id: GoalsTab; icon: typeof LayoutDashboard; labelKey: 'goal_view_board' | 'goal_view_map' | 'goal_view_timeline' }> = [
  { id: 'board', icon: LayoutDashboard, labelKey: 'goal_view_board' },
  { id: 'map', icon: Waypoints, labelKey: 'goal_view_map' },
  { id: 'timeline', icon: CalendarClock, labelKey: 'goal_view_timeline' },
];

export function TeamsSidebarNav() {
  const { t } = useTranslation();
  const teamsTab = useSystemStore((s) => s.teamsTab);
  const setTeamsTab = useSystemStore((s) => s.setTeamsTab);
  const goalsTab = useSystemStore((s) => s.goalsTab);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);
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

      {/* Goals hub — view submenu (board/map/timeline) underneath */}
      <div className="mt-3 pt-3 border-t border-primary/10 space-y-0.5">
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
        {teamsTab === 'goals' && (
          <div className="ml-3 pl-2 border-l border-primary/10 space-y-0.5">
            {GOAL_VIEWS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.id}
                  data-testid={`goals-view-${v.id}`}
                  onClick={() => setGoalsTab(v.id)}
                  aria-current={goalsTab === v.id ? 'page' : undefined}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors ${
                    goalsTab === v.id
                      ? 'bg-primary/10 text-foreground/90 font-medium'
                      : 'text-foreground/70 hover:bg-secondary/30 hover:text-foreground/90'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{t.plugins.dev_lifecycle[v.labelKey]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}

export default TeamsSidebarNav;
