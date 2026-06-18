import { useEffect, useMemo } from 'react';
import { Users, Target, LayoutDashboard, Waypoints, CalendarClock, Gauge, Inbox, Factory } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { isOngoing } from '@/features/teams/sub_goals/goalStatus';
import type { TeamsTab, GoalsTab, KpisTab } from '@/lib/types/types';

/**
 * L2 nav for the Teams section (Teams promoted to 1st-level; Goals
 * consolidated underneath). Two entries:
 *
 * - **Workspace** — the team management table / canvas. Carries the team
 *   roster underneath (click a team to open its Studio), preserving the
 *   roster UX that previously lived inside the Agents section.
 * - **Goals** — the Goals hub, with its view submenu (Board / Timeline)
 *   nested underneath, mirroring the team-roster indent pattern.
 */
const GOAL_VIEWS: Array<{ id: GoalsTab; icon: typeof LayoutDashboard; labelKey: 'goal_view_board' | 'goal_view_timeline' }> = [
  { id: 'board', icon: LayoutDashboard, labelKey: 'goal_view_board' },
  { id: 'timeline', icon: CalendarClock, labelKey: 'goal_view_timeline' },
];

// KPI hub sub-views — sidebar sub-items mirroring GOAL_VIEWS. Labels reuse the
// existing kpis.view_* keys (no new i18n).
const KPI_VIEWS: Array<{ id: KpisTab; icon: typeof LayoutDashboard; labelKey: 'view_dashboard' | 'view_rollup' | 'view_proposals' }> = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'view_dashboard' },
  { id: 'rollup', icon: Waypoints, labelKey: 'view_rollup' },
  { id: 'proposals', icon: Inbox, labelKey: 'view_proposals' },
];

export function TeamsSidebarNav() {
  const { t } = useTranslation();
  const teamsTab = useSystemStore((s) => s.teamsTab);
  const setTeamsTab = useSystemStore((s) => s.setTeamsTab);
  const goalsTab = useSystemStore((s) => s.goalsTab);
  const kpiProposalCount = useSystemStore((s) => s.kpis.filter((k) => k.status === 'proposed').length);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);
  const kpisTab = useSystemStore((s) => s.kpisTab);
  const setKpisTab = useSystemStore((s) => s.setKpisTab);
  const teams = usePipelineStore((s) => s.teams);
  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const selectTeam = usePipelineStore((s) => s.selectTeam);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const goals = useSystemStore((s) => s.goals);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  // Goals are normally fetched by GoalsPage; fetch here too so the count
  // badge is populated before the user ever opens the Goals hub.
  useEffect(() => {
    if (activeProjectId) void fetchGoals(activeProjectId);
  }, [activeProjectId, fetchGoals]);

  // Active = not done (canonical model) — mirrors the Teams count badge.
  const activeGoalCount = useMemo(() => goals.filter((g) => isOngoing(g.status)).length, [goals]);

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
          <span className="ml-auto typo-caption text-foreground font-mono">{teams.length}</span>
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

      {/* Goals hub — view submenu (board/timeline) underneath */}
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
          {activeGoalCount > 0 && (
            <span className="ml-auto typo-caption text-foreground font-mono">{activeGoalCount}</span>
          )}
        </button>
        {/* View submenu — always expanded; clicking a view also navigates into
            the Goals hub (so it works from anywhere in the Teams section). */}
        <div className="ml-3 pl-2 border-l border-primary/10 space-y-0.5">
          {GOAL_VIEWS.map((v) => {
            const Icon = v.icon;
            const active = teamsTab === 'goals' && goalsTab === v.id;
            return (
              <button
                key={v.id}
                data-testid={`goals-view-${v.id}`}
                onClick={() => { go('goals'); setGoalsTab(v.id); }}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors ${
                  active
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
      </div>

      {/* KPIs — the outcome layer above goals; view submenu (Dashboard / By
          context / Proposals) nested underneath, mirroring Goals. */}
      <div className="mt-3 pt-3 border-t border-primary/10 space-y-0.5">
        <button
          data-testid="teams-kpis-nav"
          onClick={() => go('kpis')}
          aria-current={teamsTab === 'kpis' ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            teamsTab === 'kpis'
              ? 'bg-primary/10 text-foreground font-semibold'
              : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
          }`}
        >
          <Gauge className="w-4 h-4 flex-shrink-0" />
          {t.sidebar.kpis}
          {kpiProposalCount > 0 && (
            <span className="ml-auto typo-caption text-foreground font-mono">{kpiProposalCount}</span>
          )}
        </button>
        <div className="ml-3 pl-2 border-l border-primary/10 space-y-0.5">
          {KPI_VIEWS.map((v) => {
            const Icon = v.icon;
            const active = teamsTab === 'kpis' && kpisTab === v.id;
            return (
              <button
                key={v.id}
                data-testid={`kpis-view-${v.id}`}
                onClick={() => { go('kpis'); setKpisTab(v.id); }}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors ${
                  active
                    ? 'bg-primary/10 text-foreground/90 font-medium'
                    : 'text-foreground/70 hover:bg-secondary/30 hover:text-foreground/90'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{t.kpis[v.labelKey]}</span>
                {v.id === 'proposals' && kpiProposalCount > 0 && (
                  <span className="ml-auto typo-caption text-foreground/60 font-mono">{kpiProposalCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Factory — experimental next-gen KPI-management surface (mocked variants) */}
      <div className="mt-3 pt-3 border-t border-primary/10 space-y-0.5">
        <button
          data-testid="teams-factory-nav"
          onClick={() => go('factory')}
          aria-current={teamsTab === 'factory' ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            teamsTab === 'factory'
              ? 'bg-primary/10 text-foreground font-semibold'
              : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
          }`}
        >
          <Factory className="w-4 h-4 flex-shrink-0" />
          {t.sidebar.factory}
        </button>
      </div>
    </nav>
  );
}

export default TeamsSidebarNav;
