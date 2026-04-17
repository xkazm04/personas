import { useEffect, useState, useMemo } from 'react';
import { Users, Plus, List, Star, ChevronDown, Cloud, Clock } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import type { CloudTab } from '@/lib/types/types';
import { useFavoriteAgents as useFavoriteAgentsInline } from '@/hooks/agents/useFavoriteAgents';
import { useRecentAgents } from '@/hooks/agents/useRecentAgents';
import { cloudItems } from '../sidebarData';
import { useTranslation } from '@/i18n/useTranslation';

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  critical: 'bg-red-400',
  unhealthy: 'bg-red-400',
};

export function HealthDot({ grade }: { grade: string | undefined }) {
  if (!grade || !HEALTH_DOT[grade]) return null;
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${HEALTH_DOT[grade]}`}
      title={`Health: ${grade}`}
      aria-label={`Health: ${grade}`}
    />
  );
}

export function AgentsSidebarNav({ onCreatePersona }: { onCreatePersona: () => void }) {
  const { t } = useTranslation();
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const personas = useAgentStore((s) => s.personas);
  const selectedPersonaId = useAgentStore((s) => s.selectedPersonaId);
  const agentTab = useSystemStore((s) => s.agentTab);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);
  const cloudTab = useSystemStore((s) => s.cloudTab);
  const setCloudTab = useSystemStore((s) => s.setCloudTab);
  const isCreatingPersona = useSystemStore((s) => s.isCreatingPersona);
  const buildSessions = useAgentStore((s) => s.buildSessions);
  const activeBuildSessionId = useAgentStore((s) => s.activeBuildSessionId);
  const setActiveBuildSession = useAgentStore((s) => s.setActiveBuildSession);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const backgroundExecutions = useAgentStore((s) => s.backgroundExecutions);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);
  const [recentsCollapsed, setRecentsCollapsed] = useState(false);
  const isDev = import.meta.env.DEV;

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
              ? 'bg-primary/10 text-foreground/90'
              : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
          }`}
        >
          <List className="w-4 h-4 flex-shrink-0" />
          {t.shared.sidebar_extra.all_agents_label}
          <span className="ml-auto text-[11px] text-foreground/90">{personas.length}</span>
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
              return (
                <button
                  key={draft.sessionId}
                  onClick={() => {
                    setActiveBuildSession(draft.sessionId);
                    useSystemStore.getState().setIsCreatingPersona(true);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                    isActive
                      ? 'bg-violet-500/10 text-violet-300 border border-violet-500/15'
                      : 'text-foreground hover:bg-violet-500/5 hover:text-violet-300'
                  }`}
                  title={`Switch to draft: ${displayName} (${draft.phase})`}
                >
                  <LoadingSpinner className="flex-shrink-0 text-violet-400" />
                  <span className="truncate">{displayName}</span>
                  <span className="ml-auto text-[10px] text-violet-400/60 capitalize">{draft.phase}</span>
                </button>
              );
            })}
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
                {favoritePersonas.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPersona(p.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg typo-body transition-colors hover:bg-secondary/40 group"
                  >
                    <PersonaIcon icon={p.icon} color={p.color} />
                    <span className="text-foreground/90 truncate text-[13px] min-w-0">{p.name}</span>
                    <HealthDot grade={healthGrades[p.id]} />
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
                      className="ml-auto flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
                      title={t.shared.sidebar_extra.remove_favorites}
                      aria-label={t.shared.sidebar_extra.remove_favorites}
                    >
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" aria-hidden="true" />
                    </span>
                  </button>
                ))}
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
                  return (
                    <button
                      key={p.id}
                      onClick={() => selectPersona(p.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg typo-body transition-colors group ${
                        isActive
                          ? 'bg-primary/10 text-foreground/90 shadow-[0_0_12px_rgba(59,130,246,0.12)] border border-primary/20'
                          : isRunning
                            ? 'bg-orange-500/5 hover:bg-secondary/40'
                            : 'hover:bg-secondary/40'
                      }`}
                    >
                      {isRunning ? (
                        <span className="relative flex h-5 w-5 items-center justify-center flex-shrink-0">
                          <span className="absolute w-3 h-3 rounded-full animate-ping bg-orange-500/40" />
                          <span className="relative w-2.5 h-2.5 rounded-full bg-orange-500 border border-orange-600/50" />
                        </span>
                      ) : (
                        <PersonaIcon icon={p.icon} color={p.color} />
                      )}
                      <span className={`truncate text-[13px] min-w-0 ${
                        isActive ? 'text-foreground/90 font-medium' : isRunning ? 'text-orange-300/90' : 'text-foreground'
                      }`}>{p.name}</span>
                      {!isRunning && <HealthDot grade={healthGrades[p.id]} />}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
                        className="ml-auto flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
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

        {/* Cloud & Teams (dev-only, gold border) */}
        {isDev && (
          <div className="mt-3 pt-3 border-t border-amber-500/20 space-y-1">
            <button
              onClick={() => { selectPersona(null); setAgentTab('team'); useSystemStore.getState().setIsCreatingPersona(false); }}
              aria-current={agentTab === 'team' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ring-1 ring-amber-500/40 ${
                agentTab === 'team'
                  ? 'bg-amber-500/10 text-foreground/90'
                  : 'text-foreground hover:bg-amber-500/5 hover:text-foreground/80'
              }`}
            >
              <Users className="w-4 h-4 flex-shrink-0" />
              Teams
            </button>
            <button
              onClick={() => { selectPersona(null); setAgentTab('cloud'); useSystemStore.getState().setIsCreatingPersona(false); }}
              aria-current={agentTab === 'cloud' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ring-1 ring-amber-500/40 ${
                agentTab === 'cloud'
                  ? 'bg-amber-500/10 text-foreground/90'
                  : 'text-foreground hover:bg-amber-500/5 hover:text-foreground/80'
              }`}
            >
              <Cloud className="w-4 h-4 flex-shrink-0" />
              Cloud
            </button>
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

