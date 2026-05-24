import { useEffect, useState, useMemo } from 'react';
import { Users, Plus, List, Star, ChevronDown, Cloud, Clock, Activity, FolderGit2, Sparkles } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import type { CloudTab } from '@/lib/types/types';
import { useFavoriteAgents as useFavoriteAgentsInline } from '@/hooks/agents/useFavoriteAgents';
import { usePrefetchOnHover } from '@/hooks/agents/usePrefetchOnHover';
import { useRecentAgents } from '@/hooks/agents/useRecentAgents';
import { useSidebarAgentActivity, type AgentActivityType } from '@/hooks/sidebar/useSidebarAgentActivity';
import { useCodebasePersonas } from '@/hooks/sidebar/useCodebasePersonas';
import { cloudItems } from '../sidebarData';
import { useTranslation } from '@/i18n/useTranslation';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { TIERS, isTierVisible } from '@/lib/constants/uiModes';

// Color classes per activity type — mirror the SidebarLevel1 orbit dots so
// users see the same signal at both hierarchy levels.
const PROGRESS_COLORS: Record<AgentActivityType, { dot: string; ping: string; text: string; bg: string; border: string }> = {
  draft: { dot: 'bg-violet-500',  ping: 'bg-violet-500/40',  text: 'text-violet-300',  bg: 'bg-violet-500/5',  border: 'border-violet-500/20' },
  exec:  { dot: 'bg-blue-500',    ping: 'bg-blue-500/40',    text: 'text-blue-300',    bg: 'bg-blue-500/5',    border: 'border-blue-500/20' },
  lab:   { dot: 'bg-orange-500',  ping: 'bg-orange-500/40',  text: 'text-orange-300',  bg: 'bg-orange-500/5',  border: 'border-orange-500/20' },
};

// Health status rendered as a colored 3px left border on the persona row
// instead of a separate icon + dot. Frees the full row width for the
// persona name. Running state (orange) takes precedence over health so
// in-flight execution is the dominant signal when both apply. The
// `border-l-[3px]` width is always reserved so rows align horizontally
// regardless of whether a status color is present.
const HEALTH_BORDER: Record<string, string> = {
  healthy:   'border-l-emerald-400',
  degraded:  'border-l-amber-400',
  critical:  'border-l-red-400',
  unhealthy: 'border-l-red-400',
};

function rowStatusBorder(grade: string | undefined, isRunning: boolean): string {
  if (isRunning) return 'border-l-[3px] border-l-orange-500';
  const healthClass = grade ? HEALTH_BORDER[grade] : undefined;
  return `border-l-[3px] ${healthClass ?? 'border-l-transparent'}`;
}

function rowStatusTitle(grade: string | undefined, isRunning: boolean): string | undefined {
  if (isRunning) return 'Running';
  if (grade) return `Health: ${grade}`;
  return undefined;
}

export function AgentsSidebarNav({ onCreatePersona }: { onCreatePersona: () => void }) {
  const { t } = useTranslation();
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const personas = useAgentStore((s) => s.personas);
  const selectedPersonaId = useAgentStore((s) => s.selectedPersonaId);
  const agentTab = useSystemStore((s) => s.agentTab);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);
  // Team roster for the expandable "Teams" sidebar entry.
  const teams = usePipelineStore((s) => s.teams);
  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const selectTeam = usePipelineStore((s) => s.selectTeam);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const cloudTab = useSystemStore((s) => s.cloudTab);
  const setCloudTab = useSystemStore((s) => s.setCloudTab);
  const isCreatingPersona = useSystemStore((s) => s.isCreatingPersona);
  const buildSessions = useAgentStore((s) => s.buildSessions);
  const activeBuildSessionId = useAgentStore((s) => s.activeBuildSessionId);
  const setActiveBuildSession = useAgentStore((s) => s.setActiveBuildSession);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const backgroundExecutions = useAgentStore((s) => s.backgroundExecutions);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const devProjects = useSystemStore((s) => s.projects);
  const fetchDevProjects = useSystemStore((s) => s.fetchProjects);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);
  const [recentsCollapsed, setRecentsCollapsed] = useState(false);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [activeProjectCollapsed, setActiveProjectCollapsed] = useState(false);
  const isDev = import.meta.env.DEV;
  const tier = useTier();
  const isTeamVisible = isTierVisible(TIERS.TEAM, tier.current);
  const { getPrefetchProps } = usePrefetchOnHover();

  // Per-persona activity from the same aggregator powering the L1 orbit dots.
  // Here we group by persona so the list shows each agent with one or more
  // colored indicators depending on what it's doing (draft / exec / lab).
  const activities = useSidebarAgentActivity();
  const progressEntries = useMemo(() => {
    const byPersona = new Map<string, { personaId: string; personaName: string; types: Set<AgentActivityType>; labels: string[] }>();
    for (const a of activities) {
      const existing = byPersona.get(a.personaId);
      if (existing) {
        existing.types.add(a.type);
        existing.labels.push(a.label);
      } else {
        byPersona.set(a.personaId, {
          personaId: a.personaId,
          personaName: a.personaName,
          types: new Set([a.type]),
          labels: [a.label],
        });
      }
    }
    // Stable order: drafts first, then execs, then labs, within each sorted by name.
    const typePriority = (types: Set<AgentActivityType>) => (
      (types.has('draft') ? 0 : types.has('exec') ? 1 : 2)
    );
    return Array.from(byPersona.values()).sort((a, b) => {
      const pa = typePriority(a.types);
      const pb = typePriority(b.types);
      if (pa !== pb) return pa - pb;
      return a.personaName.localeCompare(b.personaName);
    });
  }, [activities]);

  // Keep the Teams sub-list fresh whenever the Teams tab is active so the
  // sidebar roster matches the management table.
  useEffect(() => {
    if (agentTab === 'team') void fetchTeams();
  }, [agentTab, fetchTeams]);

  // Health grades for per-agent dots (lazy-loaded from overviewStore)
  const [healthGrades, setHealthGrades] = useState<Record<string, string>>({});
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      const update = (signals: Array<{ personaId: string; grade: string }>) => {
        const map: Record<string, string> = {};
        for (const s of signals) map[s.personaId] = s.grade;
        setHealthGrades(map);
      };
      update(useOverviewStore.getState().healthSignals);
      unsub = useOverviewStore.subscribe((s) => update(s.healthSignals));
    });
    return () => unsub?.();
  }, []);

  // Set of persona IDs that are currently executing (foreground + background)
  const executingPersonaIds = useMemo(() => {
    const ids = new Set<string>();
    if (isExecuting && executionPersonaId) ids.add(executionPersonaId);
    for (const bg of backgroundExecutions) {
      if (bg.status === 'running' || bg.status === 'queued') ids.add(bg.personaId);
    }
    return ids;
  }, [isExecuting, executionPersonaId, backgroundExecutions]);

  // Active draft builds — one entry per persona. Multiple sessions can
  // reference the same persona (e.g. user closed and re-opened adoption);
  // deduplicate by personaId so the sidebar shows one dot per agent draft,
  // keeping the most recent session for each persona.
  const activeDrafts = useMemo(() => {
    const byPersona = new Map<string, (typeof buildSessions)[string]>();
    for (const sess of Object.values(buildSessions)) {
      if (sess.phase === 'initializing' || sess.phase === 'promoted') continue;
      const existing = byPersona.get(sess.personaId);
      if (!existing || sess.createdAt > existing.createdAt) {
        byPersona.set(sess.personaId, sess);
      }
    }
    return [...byPersona.values()]
      .map((sess) => ({
        sessionId: sess.sessionId,
        personaId: sess.personaId,
        phase: sess.phase,
        // A-grade Phase 3 (2026-05-03): surface pending-question count
        // alongside the phase so a backgrounded draft visibly signals
        // "needs your answers" without the user clicking in.
        pendingCount: sess.pendingQuestions.length,
        persona: personas.find((p) => p.id === sess.personaId),
        createdAt: sess.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [buildSessions, personas]);

  // Favorites from localStorage
  const { favorites, toggleFavorite } = useFavoriteAgentsInline();
  const favoritePersonas = useMemo(
    () => personas.filter((p) => favorites.has(p.id)),
    [personas, favorites],
  );

  // Recent personas from localStorage
  const { recentIds } = useRecentAgents();
  const recentPersonas = useMemo(
    () => recentIds
      .filter((id) => !favorites.has(id)) // exclude already-favorited
      .map((id) => personas.find((p) => p.id === id))
      .filter(Boolean) as typeof personas,
    [personas, recentIds, favorites],
  );

  // Personas attached to the "codebase" built-in connector. Combined with
  // the user's currently-active Dev Tools project, these are the agents
  // that can operate on the active codebase. Section is hidden entirely
  // when no project is active or no persona has the connector.
  const codebasePersonaIds = useCodebasePersonas();
  useEffect(() => {
    if (devProjects.length === 0) {
      void fetchDevProjects();
    }
  }, [devProjects.length, fetchDevProjects]);
  const activeProject = useMemo(
    () => devProjects.find((p) => p.id === activeProjectId) ?? null,
    [devProjects, activeProjectId],
  );
  const activeProjectPersonas = useMemo(
    () => (activeProjectId ? personas.filter((p) => codebasePersonaIds.has(p.id)) : []),
    [personas, codebasePersonaIds, activeProjectId],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-primary/10">
        <div className="flex items-center justify-between">
          <span className="typo-label text-foreground/90">{t.shared.sidebar_extra.agents}</span>
          <button
            onClick={onCreatePersona}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Create
          </button>
        </div>
      </div>

      {/* Nav items */}
      <div className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
        {/* All Agents */}
        <button
          onClick={() => { selectPersona(null); setAgentTab('all'); useSystemStore.getState().setIsCreatingPersona(false); }}
          aria-current={agentTab === 'all' && !isCreatingPersona ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            agentTab === 'all' && !isCreatingPersona
              ? 'bg-primary/10 text-foreground/90 font-semibold'
              : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80 font-normal'
          }`}
        >
          <List className="w-4 h-4 flex-shrink-0" />
          {t.shared.sidebar_extra.all_agents_label}
          <span className="ml-auto text-[11px] text-foreground/90">{personas.length}</span>
        </button>

        {/* Plan a goal — read-only narrated planner (idea-ba306c32) */}
        <button
          data-testid="tab-planner"
          onClick={() => { selectPersona(null); setAgentTab('planner'); useSystemStore.getState().setIsCreatingPersona(false); }}
          aria-current={agentTab === 'planner' && !isCreatingPersona ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            agentTab === 'planner' && !isCreatingPersona
              ? 'bg-primary/10 text-foreground/90 font-semibold'
              : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80 font-normal'
          }`}
        >
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          {t.planner.nav_label}
        </button>

        {/* Active draft builds — one row per session in the buildSessions map.
            Click to switch to that draft. "New draft" button starts another one. */}
        {activeDrafts.length > 0 && (
          <div className="mt-1 space-y-0.5">
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-[10px] uppercase tracking-wider text-violet-400/50 font-medium">
                {t.shared.sidebar_extra.draft_builds}{activeDrafts.length > 1 ? ` (${activeDrafts.length})` : ''}
              </span>
            </div>
            {activeDrafts.map((draft) => {
              const isActive = isCreatingPersona && draft.sessionId === activeBuildSessionId;
              const displayName = draft.persona?.name ?? 'Draft agent';
              const needsAnswers = draft.pendingCount > 0 || draft.phase === 'awaiting_input';
              return (
                <button
                  key={draft.sessionId}
                  onClick={() => {
                    setActiveBuildSession(draft.sessionId);
                    useSystemStore.getState().setIsCreatingPersona(true);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                    isActive
                      ? needsAnswers
                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold'
                        : 'bg-violet-500/10 text-violet-300 border border-violet-500/15 font-semibold'
                      : needsAnswers
                        ? 'text-foreground hover:bg-amber-500/5 hover:text-amber-300 font-normal'
                        : 'text-foreground hover:bg-violet-500/5 hover:text-violet-300 font-normal'
                  }`}
                  title={
                    needsAnswers
                      ? `${displayName} — needs ${draft.pendingCount || 1} answer${(draft.pendingCount || 1) === 1 ? '' : 's'}`
                      : `Switch to draft: ${displayName} (${draft.phase})`
                  }
                >
                  <LoadingSpinner className={`flex-shrink-0 ${needsAnswers ? 'text-amber-400' : 'text-violet-400'}`} />
                  <span className="truncate">{displayName}</span>
                  {needsAnswers ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-amber-300">
                      <span aria-hidden="true">?</span>
                      {draft.pendingCount > 0 ? draft.pendingCount : ''}
                    </span>
                  ) : (
                    <span className="ml-auto text-[10px] text-violet-400/60 capitalize">{draft.phase}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Active Dev Tools project — personas with the built-in "codebase"
            connector. Shown only when a project is selected AND at least one
            persona is wired up; otherwise hidden so the sidebar doesn't
            advertise an empty group. */}
        {activeProject && activeProjectPersonas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <button
              onClick={() => setActiveProjectCollapsed(!activeProjectCollapsed)}
              aria-expanded={!activeProjectCollapsed}
              className="w-full flex items-center gap-2 px-3 py-1.5 typo-label text-indigo-400/70 hover:text-indigo-400/90 transition-colors"
              title={`Active project: ${activeProject.name}${activeProject.root_path ? ` — ${activeProject.root_path}` : ''}`}
            >
              <FolderGit2 className="w-3 h-3" aria-hidden="true" />
              <span className="truncate min-w-0">{activeProject.name}</span>
              <span className="text-[10px] font-mono text-indigo-400/50 ml-0.5">{activeProjectPersonas.length}</span>
              <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${activeProjectCollapsed ? '-rotate-90' : ''}`} />
            </button>
            {!activeProjectCollapsed && (
              <div className="mt-1 space-y-0.5">
                {activeProjectPersonas.map((p) => {
                  const isRunning = executingPersonaIds.has(p.id);
                  const isActive = selectedPersonaId === p.id && !isCreatingPersona;
                  const statusBorder = rowStatusBorder(healthGrades[p.id], isRunning);
                  const statusTitle = rowStatusTitle(healthGrades[p.id], isRunning);
                  return (
                    <button
                      key={p.id}
                      {...getPrefetchProps(p.id)}
                      onClick={() => selectPersona(p.id)}
                      aria-current={isActive ? 'page' : undefined}
                      title={statusTitle}
                      className={`w-full flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-lg typo-body transition-colors group ${statusBorder} ${
                        isActive
                          ? 'bg-primary/10 text-foreground/90 shadow-[0_0_12px_rgba(99,102,241,0.12)] border border-indigo-500/20'
                          : isRunning
                            ? 'bg-orange-500/5 hover:bg-secondary/40'
                            : 'hover:bg-secondary/40'
                      }`}
                    >
                      <span className={`truncate text-[13px] min-w-0 flex-1 text-left ${
                        isActive ? 'text-foreground/90 font-medium' : isRunning ? 'text-orange-300/90' : 'text-foreground'
                      }`}>{p.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Favorites section */}
        {favoritePersonas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <button
              onClick={() => setFavoritesCollapsed(!favoritesCollapsed)}
              aria-expanded={!favoritesCollapsed}
              className="w-full flex items-center gap-2 px-3 py-1.5 typo-label text-amber-400/60 hover:text-amber-400/80 transition-colors"
            >
              <Star className="w-3 h-3 fill-amber-400/60" aria-hidden="true" />
              Favorites
              <span className="text-[10px] font-mono text-amber-400/40 ml-0.5">{favoritePersonas.length}</span>
              <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${favoritesCollapsed ? '-rotate-90' : ''}`} />
            </button>
            {!favoritesCollapsed && (
              <div className="mt-1 space-y-0.5">
                {favoritePersonas.map((p) => {
                  const isRunning = executingPersonaIds.has(p.id);
                  const statusBorder = rowStatusBorder(healthGrades[p.id], isRunning);
                  const statusTitle = rowStatusTitle(healthGrades[p.id], isRunning);
                  return (
                    <button
                      key={p.id}
                      {...getPrefetchProps(p.id)}
                      onClick={() => selectPersona(p.id)}
                      title={statusTitle}
                      className={`w-full flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-lg typo-body transition-colors hover:bg-secondary/40 group ${statusBorder}`}
                    >
                      <span className="text-foreground/90 truncate text-[13px] min-w-0 flex-1 text-left">{p.name}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
                        className="flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
                        title={t.shared.sidebar_extra.remove_favorites}
                        aria-label={t.shared.sidebar_extra.remove_favorites}
                      >
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Recent section */}
        {recentPersonas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <button
              onClick={() => setRecentsCollapsed(!recentsCollapsed)}
              aria-expanded={!recentsCollapsed}
              className="w-full flex items-center gap-2 px-3 py-1.5 typo-label text-blue-400/60 hover:text-blue-400/80 transition-colors"
            >
              <Clock className="w-3 h-3" aria-hidden="true" />
              Recent
              <span className="text-[10px] font-mono text-blue-400/40 ml-0.5">{recentPersonas.length}</span>
              <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${recentsCollapsed ? '-rotate-90' : ''}`} />
            </button>
            {!recentsCollapsed && (
              <div className="mt-1 space-y-0.5">
                {recentPersonas.map((p) => {
                  const isRunning = executingPersonaIds.has(p.id);
                  const isActive = selectedPersonaId === p.id && !isCreatingPersona;
                  const statusBorder = rowStatusBorder(healthGrades[p.id], isRunning);
                  const statusTitle = rowStatusTitle(healthGrades[p.id], isRunning);
                  return (
                    <button
                      key={p.id}
                      {...getPrefetchProps(p.id)}
                      onClick={() => selectPersona(p.id)}
                      aria-current={isActive ? 'page' : undefined}
                      title={statusTitle}
                      className={`w-full flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-lg typo-body transition-colors group ${statusBorder} ${
                        isActive
                          ? 'bg-primary/10 text-foreground/90 shadow-[0_0_12px_rgba(59,130,246,0.12)] border border-primary/20'
                          : isRunning
                            ? 'bg-orange-500/5 hover:bg-secondary/40'
                            : 'hover:bg-secondary/40'
                      }`}
                    >
                      <span className={`truncate text-[13px] min-w-0 flex-1 text-left ${
                        isActive ? 'text-foreground/90 font-medium' : isRunning ? 'text-orange-300/90' : 'text-foreground'
                      }`}>{p.name}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
                        className="flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
                        title={t.shared.sidebar_extra.add_favorites}
                        aria-label={t.shared.sidebar_extra.add_favorites}
                      >
                        <Star className="w-3 h-3 text-foreground/90" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Progress section — one entry per persona with active work.
            Mirrors the colors used by the L1 orbit dots so the same task
            class is visually consistent across the whole sidebar. */}
        {progressEntries.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <button
              onClick={() => setProgressCollapsed(!progressCollapsed)}
              aria-expanded={!progressCollapsed}
              className="w-full flex items-center gap-2 px-3 py-1.5 typo-label text-emerald-400/60 hover:text-emerald-400/80 transition-colors"
            >
              <Activity className="w-3 h-3" aria-hidden="true" />
              {t.shared.sidebar_extra.progress}
              <span className="text-[10px] font-mono text-emerald-400/40 ml-0.5">{progressEntries.length}</span>
              <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${progressCollapsed ? '-rotate-90' : ''}`} />
            </button>
            {!progressCollapsed && (
              <div className="mt-1 space-y-0.5">
                {progressEntries.map((entry) => {
                  const isActive = selectedPersonaId === entry.personaId && !isCreatingPersona;
                  const isRunning = executingPersonaIds.has(entry.personaId);
                  const statusBorder = rowStatusBorder(healthGrades[entry.personaId], isRunning);
                  // Tooltip: show all active task labels for this persona.
                  const tooltip = `${entry.personaName}\n${entry.labels.join(' · ')}`;
                  return (
                    <button
                      key={entry.personaId}
                      {...getPrefetchProps(entry.personaId)}
                      onClick={() => selectPersona(entry.personaId)}
                      aria-current={isActive ? 'page' : undefined}
                      title={tooltip}
                      className={`w-full flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-lg typo-body transition-colors group ${statusBorder} ${
                        isActive
                          ? 'bg-primary/10 text-foreground/90 shadow-[0_0_12px_rgba(59,130,246,0.12)] border border-primary/20'
                          : 'hover:bg-secondary/40'
                      }`}
                    >
                      <span className={`truncate text-[13px] min-w-0 flex-1 text-left ${
                        isActive ? 'text-foreground/90 font-medium' : 'text-foreground'
                      }`}>{entry.personaName}</span>
                      {/* One pulsing dot per task class this persona has in flight. */}
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {(['draft', 'exec', 'lab'] as const)
                          .filter((type) => entry.types.has(type))
                          .map((type) => {
                            const meta = PROGRESS_COLORS[type];
                            return (
                              <span
                                key={type}
                                className="relative flex h-2 w-2"
                                aria-label={type}
                              >
                                <span className={`absolute inset-0 rounded-full animate-ping ${meta.ping}`} />
                                <span className={`relative w-2 h-2 rounded-full ${meta.dot}`} />
                              </span>
                            );
                          })}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Teams (productionized at TEAM tier) + Cloud (still dev-only).
            Groups→Teams consolidation (Phase 4): the standalone "Groups"
            entry is retired — workspace grouping now lives inside Teams
            (a team is the workspace). Personas' groups migrated to
            home-team membership in Phase 3. */}
        {(isTeamVisible || isDev) && (
          <div className="mt-3 pt-3 border-t border-primary/10 space-y-1">
            {isTeamVisible && (
              <>
                {/* Teams header → management table (deselects any open team) */}
                <button
                  onClick={() => { selectPersona(null); selectTeam(null); setAgentTab('team'); useSystemStore.getState().setIsCreatingPersona(false); }}
                  aria-current={agentTab === 'team' && !selectedTeamId ? 'page' : undefined}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                    agentTab === 'team' && !selectedTeamId
                      ? 'bg-primary/10 text-foreground/90 font-semibold'
                      : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80 font-normal'
                  }`}
                >
                  <Users className="w-4 h-4 flex-shrink-0" />
                  {t.shared.sidebar_extra.teams_label}
                  {teams.length > 0 && (
                    <span className="ml-auto typo-caption text-foreground/45 font-mono">{teams.length}</span>
                  )}
                </button>
                {/* Team roster — click a name to open its Studio. Shown
                    whenever the Teams section is active. */}
                {agentTab === 'team' && teams.length > 0 && (
                  <div className="ml-3 pl-2 border-l border-primary/10 space-y-0.5">
                    {[...teams]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((team) => (
                        <button
                          key={team.id}
                          onClick={() => { selectPersona(null); selectTeam(team.id); setAgentTab('team'); }}
                          aria-current={selectedTeamId === team.id ? 'page' : undefined}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors ${
                            selectedTeamId === team.id
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
              </>
            )}
            {isDev && (
              <button
                onClick={() => { selectPersona(null); setAgentTab('cloud'); useSystemStore.getState().setIsCreatingPersona(false); }}
                aria-current={agentTab === 'cloud' ? 'page' : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ring-1 ring-amber-500/40 ${
                  agentTab === 'cloud'
                    ? 'bg-amber-500/10 text-foreground/90 font-semibold'
                    : 'text-foreground hover:bg-amber-500/5 hover:text-foreground/80 font-normal'
                }`}
              >
                <Cloud className="w-4 h-4 flex-shrink-0" />
                <span>{t.shared.sidebar_extra.cloud_label}</span>
                <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300/80 font-medium">
                  {t.shared.sidebar_extra.cloud_dev_pill}
                </span>
              </button>
            )}
            {/* Cloud sub-tabs */}
            {agentTab === 'cloud' && (
              <div className="ml-4 space-y-0.5">
                {cloudItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCloudTab(item.id as CloudTab)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                      cloudTab === item.id
                        ? 'bg-primary/10 text-foreground'
                        : 'text-foreground hover:bg-secondary/40 hover:text-foreground/70'
                    }`}
                  >
                    {item.icon && <item.icon className="w-3.5 h-3.5 flex-shrink-0" />}
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Plugins sidebar (extensibility hub) --
