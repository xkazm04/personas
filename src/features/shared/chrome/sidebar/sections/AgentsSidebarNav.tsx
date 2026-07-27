import { useEffect, useState, useMemo } from 'react';
import { Plus, List, Star, Cloud, Clock, Activity, FolderGit2, Hammer } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import type { CloudTab } from '@/lib/types/types';
import { useFavoriteAgents as useFavoriteAgentsInline } from '@/hooks/agents/useFavoriteAgents';
import { usePrefetchOnHover } from '@/hooks/agents/usePrefetchOnHover';
import { useRecentAgents } from '@/hooks/agents/useRecentAgents';
import { useSidebarAgentActivity, type AgentActivityType } from '@/hooks/sidebar/useSidebarAgentActivity';
import { useCodebasePersonas } from '@/hooks/sidebar/useCodebasePersonas';
import { cloudItems } from '@/features/shared/chrome/sidebar/sidebarData';
import SidebarGroupNav, { childRowClass, type SidebarNavGroup } from '@/features/shared/chrome/sidebar/SidebarGroupNav';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

// Build-session phases that must NOT appear in the sidebar's Draft builds
// section: never-started (initializing) and every terminal phase. Terminal
// sessions (failed/cancelled/completed) previously lingered here forever with
// a spinner — e.g. a promoted persona whose stale session was parked at a
// terminal state kept a phantom "draft" row.
const HIDDEN_DRAFT_PHASES = new Set(['initializing', 'promoted', 'completed', 'failed', 'cancelled']);

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
  const { t, tx } = useTranslation();
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const personas = useAgentStore((s) => s.personas);
  const selectedPersonaId = useAgentStore((s) => s.selectedPersonaId);
  const agentTab = useSystemStore((s) => s.agentTab);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);
  // Team roster for the expandable "Teams" sidebar entry.
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
  const isDev = import.meta.env.DEV;
  const { getPrefetchProps } = usePrefetchOnHover();

  // Per-persona activity from the same aggregator powering the L1 orbit dots.
  // Here we group by persona so the list shows each agent with one or more
  // colored indicators depending on what it's doing (draft / exec / lab).
  // Personas that currently have an active draft build session. A draft's
  // home is the dedicated "Draft" section, so these IDs are excluded from
  // the Recent and Progress sections below — otherwise a single
  // (template-adopted or scratch) draft shows up in three places at once.
  // Matches the activeDrafts phase filter (exclude initializing/promoted).
  const draftPersonaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sess of Object.values(buildSessions)) {
      if (HIDDEN_DRAFT_PHASES.has(sess.phase)) continue;
      ids.add(sess.personaId);
    }
    return ids;
  }, [buildSessions]);

  const activities = useSidebarAgentActivity();
  const progressEntries = useMemo(() => {
    const byPersona = new Map<string, { personaId: string; personaName: string; types: Set<AgentActivityType>; labels: string[] }>();
    for (const a of activities) {
      // Drafts live in the dedicated Draft section — keep Progress to
      // execution / lab activity only so a draft isn't double-listed.
      if (draftPersonaIds.has(a.personaId)) continue;
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
  }, [activities, draftPersonaIds]);

  // Keep the Teams sub-list fresh whenever the Teams tab is active so the
  // sidebar roster matches the management table.
  

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
      if (HIDDEN_DRAFT_PHASES.has(sess.phase)) continue;
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
      .filter((id) => !draftPersonaIds.has(id)) // exclude active drafts (shown in Draft section)
      .map((id) => personas.find((p) => p.id === id))
      .filter(Boolean) as typeof personas,
    [personas, recentIds, favorites, draftPersonaIds],
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

  // ── Row renderers ───────────────────────────────────────────────────
  // Persona rows live inside a group's left rail, so they use the shared
  // `childRowClass` and only add what's specific to an agent: the health /
  // running status border and the favorite toggle.

  const personaRow = (
    p: { id: string; name: string },
    opts: { favorite: boolean; tooltip?: string; trailing?: React.ReactNode } = { favorite: false },
  ) => {
    const isRunning = executingPersonaIds.has(p.id);
    const isActive = selectedPersonaId === p.id && !isCreatingPersona;
    const statusBorder = rowStatusBorder(healthGrades[p.id], isRunning);
    return (
      <button
        type="button"
        key={p.id}
        {...getPrefetchProps(p.id)}
        onClick={() => selectPersona(p.id)}
        aria-current={isActive ? 'page' : undefined}
        title={opts.tooltip ?? rowStatusTitle(healthGrades[p.id], isRunning)}
        className={`${childRowClass(isActive)} group ${statusBorder} ${isRunning && !isActive ? 'bg-orange-500/5' : ''}`}
      >
        <span className={`truncate min-w-0 flex-1 text-left ${isRunning && !isActive ? 'text-orange-300/90' : ''}`}>
          {p.name}
        </span>
        {opts.trailing}
        {opts.favorite && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
            className="flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
            title={favorites.has(p.id) ? t.shared.sidebar_extra.remove_favorites : t.shared.sidebar_extra.add_favorites}
            aria-label={favorites.has(p.id) ? t.shared.sidebar_extra.remove_favorites : t.shared.sidebar_extra.add_favorites}
          >
            <Star className={`w-3 h-3 ${favorites.has(p.id) ? 'text-amber-400 fill-amber-400' : 'text-foreground/90'}`} aria-hidden="true" />
          </span>
        )}
      </button>
    );
  };

  // ── Dynamic groups ──────────────────────────────────────────────────
  // Agents has no fixed group set: sections appear and disappear with the
  // user's actual state (a draft in flight, an active project, favorites).
  // Each one is still rendered through the shared group primitive so it
  // reads identically to the static sections.

  const groups: SidebarNavGroup[] = [];

  if (activeDrafts.length > 0) {
    groups.push({
      id: 'drafts',
      label: t.shared.sidebar_extra.draft_builds,
      icon: Hammer,
      accentClass: 'text-violet-400/70 hover:text-violet-400/90',
      count: activeDrafts.length,
      collapsible: true,
      render: activeDrafts.map((draft) => {
        const isActive = isCreatingPersona && draft.sessionId === activeBuildSessionId;
        const displayName = draft.persona?.name ?? t.shared.sidebar_extra.draft_agent_fallback;
        const needsAnswers = draft.pendingCount > 0 || draft.phase === 'awaiting_input';
        const phaseLabel = tokenLabel(t, 'build', draft.phase);
        return (
          <button
            type="button"
            key={draft.sessionId}
            onClick={() => {
              setActiveBuildSession(draft.sessionId);
              useSystemStore.getState().setIsCreatingPersona(true);
            }}
            aria-current={isActive ? 'page' : undefined}
            className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors text-left ${
              isActive
                ? needsAnswers
                  ? 'bg-amber-500/10 text-amber-300 font-medium'
                  : 'bg-violet-500/10 text-violet-300 font-medium'
                : needsAnswers
                  ? 'text-foreground/70 hover:bg-amber-500/5 hover:text-amber-300'
                  : 'text-foreground/70 hover:bg-violet-500/5 hover:text-violet-300'
            }`}
            title={
              needsAnswers
                ? tx(
                    (draft.pendingCount || 1) === 1
                      ? t.shared.sidebar_extra.draft_needs_answers_one
                      : t.shared.sidebar_extra.draft_needs_answers_other,
                    { name: displayName, count: draft.pendingCount || 1 },
                  )
                : tx(t.shared.sidebar_extra.draft_switch_title, { name: displayName, phase: phaseLabel })
            }
          >
            <LoadingSpinner className={`mt-0.5 flex-shrink-0 ${needsAnswers ? 'text-amber-400' : 'text-violet-400'}`} />
            {/* Two lines: the draft's name owns the full row width and the
                phase moves to its own caption line, aligned to the rail. A
                right-pinned phase chip used to collide with longer names
                ("Test complete" ate half the row). */}
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="truncate">{displayName}</span>
              <span className={`flex items-center gap-1 truncate typo-caption ${needsAnswers ? 'text-amber-300/80' : 'text-violet-400/70'}`}>
                <span className="truncate">{phaseLabel}</span>
                {needsAnswers && (
                  <span className="flex-shrink-0" aria-hidden="true">
                    ?{draft.pendingCount > 0 ? draft.pendingCount : ''}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      }),
    });
  }

  if (activeProject && activeProjectPersonas.length > 0) {
    groups.push({
      id: 'active-project',
      label: activeProject.name,
      icon: FolderGit2,
      accentClass: 'text-indigo-400/70 hover:text-indigo-400/90',
      count: activeProjectPersonas.length,
      collapsible: true,
      render: activeProjectPersonas.map((p) => personaRow(p, { favorite: false })),
    });
  }

  if (favoritePersonas.length > 0) {
    groups.push({
      id: 'favorites',
      label: t.sidebar.favorites,
      icon: Star,
      accentClass: 'text-amber-400/70 hover:text-amber-400/90',
      count: favoritePersonas.length,
      collapsible: true,
      render: favoritePersonas.map((p) => personaRow(p, { favorite: true })),
    });
  }

  if (recentPersonas.length > 0) {
    groups.push({
      id: 'recent',
      label: t.sidebar.recent,
      icon: Clock,
      accentClass: 'text-blue-400/70 hover:text-blue-400/90',
      count: recentPersonas.length,
      collapsible: true,
      render: recentPersonas.map((p) => personaRow(p, { favorite: true })),
    });
  }

  if (progressEntries.length > 0) {
    groups.push({
      id: 'progress',
      label: t.shared.sidebar_extra.progress,
      icon: Activity,
      accentClass: 'text-emerald-400/70 hover:text-emerald-400/90',
      count: progressEntries.length,
      collapsible: true,
      render: progressEntries.map((entry) =>
        personaRow(
          { id: entry.personaId, name: entry.personaName },
          {
            favorite: false,
            tooltip: `${entry.personaName}\n${entry.labels.join(' · ')}`,
            // One pulsing dot per task class this persona has in flight.
            trailing: (
              <span className="flex items-center gap-1 flex-shrink-0">
                {(['draft', 'exec', 'lab'] as const)
                  .filter((type) => entry.types.has(type))
                  .map((type) => {
                    const meta = PROGRESS_COLORS[type];
                    return (
                      <span key={type} className="relative flex h-2 w-2" aria-label={type}>
                        <span className={`absolute inset-0 rounded-full animate-ping ${meta.ping}`} />
                        <span className={`relative w-2 h-2 rounded-full ${meta.dot}`} />
                      </span>
                    );
                  })}
              </span>
            ),
          },
        ),
      ),
    });
  }

  // Cloud (still dev-only) — a navigable group header whose sub-tabs appear
  // once the section is open. Groups→Teams consolidation (Phase 4) retired
  // the standalone "Groups" entry; a team is the workspace now.
  if (isDev) {
    groups.push({
      id: 'cloud',
      groupItem: {
        id: 'cloud-section',
        label: t.shared.sidebar_extra.cloud_label,
        icon: Cloud,
        dev: true,
        onSelect: () => {
          selectPersona(null);
          setAgentTab('cloud');
          useSystemStore.getState().setIsCreatingPersona(false);
        },
        rightSlot: (
          <span className="typo-caption uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300/80">
            {t.shared.sidebar_extra.cloud_dev_pill}
          </span>
        ),
      },
      items: agentTab === 'cloud'
        ? cloudItems.map((item) => ({ id: item.id, label: item.label, icon: item.icon }))
        : [],
    });
  }

  const allAgentsActive = agentTab === 'all' && !isCreatingPersona;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-primary/10">
        <div className="flex items-center justify-between">
          <span className="typo-label text-foreground/90">{t.shared.sidebar_extra.agents}</span>
          <button
            type="button"
            onClick={onCreatePersona}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg typo-caption font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t.sidebar.create}
          </button>
        </div>
      </div>

      <div className="flex-1 px-2 py-2 overflow-y-auto">
        <SidebarGroupNav
          ariaLabel={t.sidebar.agents}
          lead={{
            id: 'all',
            label: t.shared.sidebar_extra.all_agents_label,
            icon: List,
            badge: { count: personas.length, className: 'bg-secondary/50 border border-primary/10 text-foreground font-normal' },
            onSelect: () => {
              selectPersona(null);
              setAgentTab('all');
              useSystemStore.getState().setIsCreatingPersona(false);
            },
          }}
          groups={groups}
          activeId={agentTab === 'cloud' ? cloudTab : allAgentsActive ? 'all' : ''}
          onSelect={(id) => setCloudTab(id as CloudTab)}
        />
      </div>
    </div>
  );
}

// -- Plugins sidebar (extensibility hub) --
