import { useEffect, useMemo } from 'react';
import { Users, Target, LayoutDashboard, CalendarClock, ChartNoAxesGantt, Gauge, Inbox, Factory, FolderKanban, GitBranch, Swords, Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useImproveActivityStore, selectAnyImproveRunning } from '@/stores/improveActivityStore';
import { isOngoing } from '@/features/teams/sub_goals/goalStatus';
import type { TeamsTab, GoalsTab, KpisTab } from '@/lib/types/types';

/**
 * L2 nav for the Projects section (rebranded from Teams; the store id and the
 * PersonaTeam domain are still "teams"). Four groups:
 *
 * - **Teams** — the team management table / canvas. The per-team roster that
 *   used to hang underneath was removed: the workspace table already lists
 *   every team, so the sidebar copy was redundant and grew unbounded.
 * - **Goals** — the Goals hub + its view submenu (Board / Timeline / Progress).
 * - **KPIs** — the outcome layer + its view submenu.
 * - **Development** — a label-only group holding the project-engineering
 *   surfaces folded in from the retired Dev Tools tabs (Manage / Lifecycle /
 *   Factory / Competition). See DEV_ITEMS.
 */
const GOAL_VIEWS: Array<{ id: GoalsTab; icon: typeof LayoutDashboard; labelKey: 'goal_view_board' | 'goal_view_timeline' | 'goal_view_progress' | 'goal_view_missions' }> = [
  { id: 'board', icon: LayoutDashboard, labelKey: 'goal_view_board' },
  { id: 'missions', icon: Rocket, labelKey: 'goal_view_missions' },
  { id: 'timeline', icon: CalendarClock, labelKey: 'goal_view_timeline' },
  { id: 'progress', icon: ChartNoAxesGantt, labelKey: 'goal_view_progress' },
];

// KPI hub sub-views — sidebar sub-items mirroring GOAL_VIEWS. Labels reuse the
// existing kpis.view_* keys (no new i18n). "By context" (rollup) was folded into
// the Dashboard's grouped Distance-to-target section and retired.
const KPI_VIEWS: Array<{ id: KpisTab; icon: typeof LayoutDashboard; labelKey: 'view_dashboard' | 'view_proposals' }> = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'view_dashboard' },
  { id: 'proposals', icon: Inbox, labelKey: 'view_proposals' },
];

// "Development" group — the project-engineering surfaces folded in from the
// retired Dev Tools tabs. Grouped rather than four sibling top-level entries.
const DEV_ITEMS: Array<{
  id: Extract<TeamsTab, 'projects' | 'lifecycle' | 'factory' | 'competition'>;
  icon: typeof LayoutDashboard;
  labelKey: 'manage' | 'lifecycle' | 'factory' | 'competition';
  testId: string;
}> = [
  { id: 'projects', icon: FolderKanban, labelKey: 'manage', testId: 'teams-projects-nav' },
  { id: 'lifecycle', icon: GitBranch, labelKey: 'lifecycle', testId: 'teams-lifecycle-nav' },
  { id: 'factory', icon: Factory, labelKey: 'factory', testId: 'teams-factory-nav' },
  { id: 'competition', icon: Swords, labelKey: 'competition', testId: 'teams-competition-nav' },
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
  // A golden-standard upgrade fired from the Factory readiness matrix is running.
  const factoryRunning = useImproveActivityStore(selectAnyImproveRunning);

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

      {/* Development — the project-engineering surfaces folded in from Dev Tools
          (Manage / Lifecycle / Factory / Competition). A label-only group: none
          of these is a landing page of its own, so the header doesn't navigate. */}
      <div className="mt-3 pt-3 border-t border-primary/10">
        <div className="px-3 pb-1 typo-caption uppercase tracking-wider text-foreground/50">
          {t.sidebar.development}
        </div>
        <div className="ml-3 pl-2 border-l border-primary/10 space-y-0.5">
          {DEV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = teamsTab === item.id;
            return (
              <button
                key={item.id}
                data-testid={item.testId}
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors ${
                  active
                    ? 'bg-primary/10 text-foreground/90 font-medium'
                    : 'text-foreground/70 hover:bg-secondary/30 hover:text-foreground/90'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{t.sidebar[item.labelKey]}</span>
                {item.id === 'factory' && factoryRunning && (
                  // Decorative pulse — the running state is announced by the
                  // 1st-level badge tooltip, so aria-hidden avoids double-reading.
                  <span className="ml-auto relative flex items-center justify-center w-2.5 h-2.5" aria-hidden>
                    <span className="absolute inset-0 rounded-full animate-ping bg-violet-500/40" />
                    <span className="relative w-2 h-2 rounded-full bg-violet-500 border border-violet-600/50" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export default TeamsSidebarNav;
