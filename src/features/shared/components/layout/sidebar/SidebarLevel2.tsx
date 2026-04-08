import { useCallback, useEffect, useState, useMemo } from 'react';
import { Key, Users, Sparkles, Plus, List, Star, ChevronDown, Cloud, Wrench, Puzzle, Clock, FileSignature, ScanLine, Palette, CalendarClock, Brain } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
// useBadgeCounts removed — badge counts now passed as props from Sidebar
import type { HomeTab, OverviewTab, TemplateTab, CloudTab, SettingsTab, DevToolsTab, EventBusTab } from '@/lib/types/types';
import { useCredentialNav, type CredentialNavKey } from '@/features/vault/shared/hooks/CredentialNavContext';
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';

import { useFavoriteAgents as useFavoriteAgentsInline } from '@/hooks/agents/useFavoriteAgents';
import { useRecentAgents } from '@/hooks/agents/useRecentAgents';
import SidebarSubNav from './SidebarSubNav';
import type { SubNavBadge } from './SidebarSubNav';
import {
  homeItems, overviewItems, credentialItems, templateItems,
  cloudItems, devToolsItems, eventBusItems, getSettingsItems,
} from './sidebarData';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { filterByTier } from './sidebarData';

interface SidebarLevel2Props {
  onCreatePersona: () => void;
  pendingReviewCount?: number;
  unreadMessageCount?: number;
  pendingEventCount?: number;
}

export default function SidebarLevel2({ onCreatePersona, pendingReviewCount = 0, unreadMessageCount = 0, pendingEventCount = 0 }: SidebarLevel2Props) {
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  const { currentKey: credentialView, navigate } = useCredentialNav();
  // Vault and pipeline stores loaded lazily to keep them out of the main bundle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [credentials, setCredentials] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [connectorDefinitions, setConnectorDefinitions] = useState<any[]>([]);
  const [overviewTab, setOverviewTabState] = useState<OverviewTab>("home" as OverviewTab);
  useEffect(() => {
    let vaultUnsub: (() => void) | undefined;
    let overviewUnsub: (() => void) | undefined;
    void import("@/stores/vaultStore").then(({ useVaultStore }) => {
      const s = useVaultStore.getState();
      setCredentials(s.credentials);
      setConnectorDefinitions(s.connectorDefinitions);
      let prevCreds = s.credentials;
      let prevDefs = s.connectorDefinitions;
      vaultUnsub = useVaultStore.subscribe((s) => {
        if (s.credentials !== prevCreds) { prevCreds = s.credentials; setCredentials(s.credentials); }
        if (s.connectorDefinitions !== prevDefs) { prevDefs = s.connectorDefinitions; setConnectorDefinitions(s.connectorDefinitions); }
      });
    });
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      setOverviewTabState(useOverviewStore.getState().overviewTab);
      overviewUnsub = useOverviewStore.subscribe((s) => setOverviewTabState(s.overviewTab));
    });
    return () => { vaultUnsub?.(); overviewUnsub?.(); };
  }, []);
  const setOverviewTab = useCallback((tab: OverviewTab) => {
    setOverviewTabState(tab);
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => useOverviewStore.getState().setOverviewTab(tab));
  }, []);
  const homeTab = useSystemStore((s) => s.homeTab);
  const setHomeTab = useSystemStore((s) => s.setHomeTab);
  const templateTab = useSystemStore((s) => s.templateTab);
  const setTemplateTab = useSystemStore((s) => s.setTemplateTab);
  // Badge counts passed as props from Sidebar (single useBadgeCounts instance)
  const templateGalleryTotal = useSystemStore((s) => s.templateGalleryTotal);
  const settingsTab = useSystemStore((s) => s.settingsTab);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const eventBusTab = useSystemStore((s) => s.eventBusTab);
  const setEventBusTab = useSystemStore((s) => s.setEventBusTab);

  const isDev = import.meta.env.DEV;
  const tier = useTier();

  const filterSimple = <T extends { simpleHidden?: boolean }>(items: T[]): T[] =>
    filterByTier(items, tier.current);

  const templateCount = connectorDefinitions.filter((conn) => {
    const metadata = conn.metadata as Record<string, unknown> | null;
    return metadata?.template_enabled === true;
  }).length;

  const dbCredCount = credentials.filter((c) => {
    const def = connectorDefinitions.find((d) => d.name === c.service_type);
    return def?.category === 'database';
  }).length;

  // Badge maps
  const overviewBadges: Record<string, SubNavBadge> = {};
  if (pendingReviewCount > 0) overviewBadges['manual-review'] = { count: pendingReviewCount, className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' };
  if (unreadMessageCount > 0) overviewBadges['messages'] = { count: unreadMessageCount, className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' };
  if (pendingEventCount > 0) overviewBadges['events'] = { count: pendingEventCount, className: 'bg-purple-500/20 text-purple-400 border border-purple-500/30' };

  const credentialBadges: Record<string, SubNavBadge> = {
    credentials: { count: credentials.length, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
    databases: { count: dbCredCount, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
    'from-template': { count: templateCount, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
  };

  const settingsItems = getSettingsItems(isDev, tier.current);

  switch (sidebarSection) {
    case 'home':
      return (
        <>
          <SidebarSubNav
            items={homeItems}
            activeId={homeTab}
            onSelect={(id) => setHomeTab(id as HomeTab)}
            variant="overview"
          />
          <div className="flex-1" />
          <div className="flex items-center justify-center py-6 opacity-[0.08] pointer-events-none select-none">
            <img
              src="/illustrations/logo-v1-geometric-nobg.png"
              alt=""
              className="w-24 h-24 object-contain"
            />
          </div>
        </>
      );

    case 'overview':
      return (
        <SidebarSubNav
          items={filterSimple(overviewItems)}
          activeId={overviewTab}
          onSelect={(id) => setOverviewTab(id as OverviewTab)}
          badges={overviewBadges}
          variant="overview"
        />
      );

    case 'personas':
      return <AgentsSidebarNav onCreatePersona={onCreatePersona} />;

    case 'events': {
      const visibleEventItems = isDev ? eventBusItems : eventBusItems.filter(i => !i.devOnly);
      const eventDevSet = isDev ? new Set(eventBusItems.filter(i => i.devOnly).map(i => i.id)) : undefined;
      return (
        <SidebarSubNav
          items={visibleEventItems}
          activeId={eventBusTab}
          onSelect={(id) => setEventBusTab(id as EventBusTab)}
          devItems={eventDevSet}
        />
      );
    }

    case 'credentials':
      return (
        <SidebarSubNav
          items={filterSimple(credentialItems)}
          activeId={credentialView}
          onSelect={(id) => navigate(id as CredentialNavKey)}
          badges={credentialBadges}
        >
          {credentials.length === 0 && credentialView === 'credentials' && (
            <div className="text-center py-8 space-y-3">
              <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Key className="w-5 h-5 text-emerald-400/60" />
              </div>
              <p className="typo-body text-muted-foreground/80">No credentials yet</p>
              <Button
                variant="accent"
                accentColor="violet"
                size="md"
                icon={<Sparkles className="w-3 h-3" />}
                onClick={() => useProvisioningWizardStore.getState().open(true)}
              >
                AI Setup Wizard
              </Button>
            </div>
          )}
        </SidebarSubNav>
      );

    case 'design-reviews': {
      const { n8nTransformActive: n8nBuildActive, templateAdoptActive } = useSystemStore.getState();
      const drBadges: Record<string, SubNavBadge> = {};
      if (templateGalleryTotal > 0) drBadges['generated'] = { count: templateGalleryTotal, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' };
      const hasActiveProcess = n8nBuildActive || templateAdoptActive;
      return (
        <>
          <SidebarSubNav
            items={filterSimple(templateItems)}
            activeId={templateTab}
            onSelect={(id) => setTemplateTab(id as TemplateTab)}
            badges={Object.keys(drBadges).length > 0 ? drBadges : undefined}
          />
          {hasActiveProcess && (
            <div className={`mx-2 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg ${n8nBuildActive ? 'bg-violet-500/8 border border-violet-500/15' : 'bg-amber-500/8 border border-amber-500/15'}`}>
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className={`absolute inset-0 rounded-full animate-ping ${n8nBuildActive ? 'bg-violet-500/40' : 'bg-amber-500/40'}`} />
                <span className={`relative w-2.5 h-2.5 rounded-full ${n8nBuildActive ? 'bg-violet-500 border border-violet-600/50' : 'bg-amber-500 border border-amber-600/50'}`} />
              </span>
              <span className={`text-[11px] truncate ${n8nBuildActive ? 'text-violet-300/80' : 'text-amber-300/80'}`}>{n8nBuildActive ? 'Building persona...' : 'Adopting template...'}</span>
            </div>
          )}
        </>
      );
    }


    case 'schedules':
      return <SchedulesSidebarNav />;

    case 'plugins':
      return <PluginsSidebarNav />;

    case 'settings':
      return (
        <SidebarSubNav
          items={settingsItems}
          activeId={settingsTab}
          onSelect={(id) => setSettingsTab(id as SettingsTab)}
          devItems={isDev ? new Set(['account', 'engine', 'byom', 'network', 'quality-gates', 'config', 'admin']) : undefined}
        />
      );

    default:
      return null;
  }
}

// -- Schedules persona filter sidebar --

function SchedulesSidebarNav() {
  const personas = useAgentStore((s) => s.personas);
  const [cronAgents, setCronAgents] = useState<{ persona_id: string; persona_name: string }[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  useEffect(() => {
    void import('@/stores/overviewStore').then(({ useOverviewStore }) => {
      let prev = useOverviewStore.getState().cronAgents;
      setCronAgents(prev);
      return useOverviewStore.subscribe((s) => {
        if (s.cronAgents !== prev) { prev = s.cronAgents; setCronAgents(s.cronAgents); }
      });
    }).then((unsub) => { return () => unsub?.(); });
  }, []);

  // Unique personas participating in schedules, sorted by name asc, with schedule count
  const scheduledPersonas = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const a of cronAgents) {
      countMap.set(a.persona_id, (countMap.get(a.persona_id) ?? 0) + 1);
    }
    return personas
      .filter((p) => countMap.has(p.id))
      .map((p) => ({ ...p, scheduleCount: countMap.get(p.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cronAgents, personas]);

  // Broadcast filter to ScheduleTimeline via a custom event
  const selectFilter = useCallback((personaId: string | null) => {
    setSelectedPersonaId(personaId);
    window.dispatchEvent(new CustomEvent('schedules:filter', { detail: { personaId } }));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-primary/10">
        <div className="flex items-center justify-between">
          <span className="typo-label text-muted-foreground/50">Schedules</span>
          <span className="text-[10px] font-mono text-muted-foreground/30">{cronAgents.length} total</span>
        </div>
      </div>
      <div className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {/* All personas */}
        <button
          onClick={() => selectFilter(null)}
          aria-current={selectedPersonaId === null ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            selectedPersonaId === null
              ? 'bg-primary/10 text-foreground/90'
              : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
          }`}
        >
          <CalendarClock className="w-4 h-4 flex-shrink-0" />
          All personas
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/40">{scheduledPersonas.length}</span>
        </button>

        {/* Divider */}
        {scheduledPersonas.length > 0 && (
          <div className="mx-2 my-1.5 border-t border-primary/8" />
        )}

        {/* Individual personas sorted by name */}
        {scheduledPersonas.map((p) => (
          <button
            key={p.id}
            onClick={() => selectFilter(p.id)}
            aria-current={selectedPersonaId === p.id ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              selectedPersonaId === p.id
                ? 'bg-primary/10 text-foreground/90'
                : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <PersonaIcon icon={p.icon} color={p.color} />
            <span className="truncate text-[13px] min-w-0">{p.name}</span>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground/35 tabular-nums">{p.scheduleCount}</span>
          </button>
        ))}

        {/* Empty state */}
        {scheduledPersonas.length === 0 && (
          <div className="text-center py-10 space-y-2">
            <CalendarClock className="w-8 h-8 mx-auto text-muted-foreground/20" />
            <p className="text-[12px] text-muted-foreground/40">No agents with schedules</p>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Simplified agents sidebar (persona list removed, lives in table view now) --

function AgentsSidebarNav({ onCreatePersona }: { onCreatePersona: () => void }) {
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

  // Set of persona IDs that are currently executing (foreground + background)
  const executingPersonaIds = useMemo(() => {
    const ids = new Set<string>();
    if (isExecuting && executionPersonaId) ids.add(executionPersonaId);
    for (const bg of backgroundExecutions) {
      if (bg.status === 'running' || bg.status === 'queued') ids.add(bg.personaId);
    }
    return ids;
  }, [isExecuting, executionPersonaId, backgroundExecutions]);

  // Active draft builds — one entry per session in the buildSessions map.
  // Multiple drafts can be in progress at once; clicking switches the active one.
  const activeDrafts = useMemo(() => {
    return Object.values(buildSessions)
      .filter((sess) => sess.phase !== 'initializing' && sess.phase !== 'promoted')
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
          <span className="typo-label text-muted-foreground/50">Agents</span>
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
              : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
          }`}
        >
          <List className="w-4 h-4 flex-shrink-0" />
          All Agents
          <span className="ml-auto text-[11px] text-muted-foreground/40">{personas.length}</span>
        </button>

        {/* Active draft builds — one row per session in the buildSessions map.
            Click to switch to that draft. "New draft" button starts another one. */}
        {activeDrafts.length > 0 && (
          <div className="mt-1 space-y-0.5">
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-[10px] uppercase tracking-wider text-violet-400/50 font-medium">
                Draft builds {activeDrafts.length > 1 ? `(${activeDrafts.length})` : ''}
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
                      : 'text-muted-foreground/70 hover:bg-violet-500/5 hover:text-violet-300'
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
                    <span className="text-foreground/70 truncate text-[13px] min-w-0">{p.name}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
                      className="ml-auto flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
                      title="Remove from favorites"
                      aria-label="Remove from favorites"
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
                        isActive ? 'text-foreground/90 font-medium' : isRunning ? 'text-orange-300/90' : 'text-foreground/70'
                      }`}>{p.name}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
                        className="ml-auto flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
                        title="Add to favorites"
                        aria-label="Add to favorites"
                      >
                        <Star className="w-3 h-3 text-muted-foreground/40" aria-hidden="true" />
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
                  : 'text-muted-foreground/70 hover:bg-amber-500/5 hover:text-foreground/80'
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
                  : 'text-muted-foreground/70 hover:bg-amber-500/5 hover:text-foreground/80'
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
                        ? 'bg-primary/10 text-foreground/80'
                        : 'text-muted-foreground/60 hover:bg-secondary/40 hover:text-foreground/70'
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

function PluginsSidebarNav() {
  const pluginTab = useSystemStore((s) => s.pluginTab);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const devToolsTab = useSystemStore((s) => s.devToolsTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore((s) => s.projects);
  const creativeSessionRunning = useSystemStore((s) => s.creativeSessionRunning);

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;

  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);

  return (
    <div className="flex flex-col h-full">
      {/* Nav items */}
      <div className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
        {/* Browse */}
        <button
          onClick={() => setPluginTab('browse')}
          aria-current={pluginTab === 'browse' ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            pluginTab === 'browse'
              ? 'bg-primary/10 text-foreground/90'
              : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
          }`}
        >
          <Puzzle className="w-4 h-4 flex-shrink-0" />
          Browse
        </button>

        {/* Artist */}
        {enabledPlugins.has('artist') && (
          <button
            onClick={() => setPluginTab('artist')}
            aria-current={pluginTab === 'artist' ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              pluginTab === 'artist'
                ? 'bg-primary/10 text-foreground/90'
                : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <Palette className="w-4 h-4 flex-shrink-0" />
            Artist
            {creativeSessionRunning && (
              <span className="relative ml-auto flex h-2.5 w-2.5">
                <span className="absolute inset-0 rounded-full animate-ping bg-orange-500/40" />
                <span className="relative w-2.5 h-2.5 rounded-full bg-orange-500 border border-orange-600/50" />
              </span>
            )}
          </button>
        )}

        {/* Dev Tools */}
        {enabledPlugins.has('dev-tools') && (
          <div className="space-y-1">
            <button
              onClick={() => setPluginTab('dev-tools')}
              aria-current={pluginTab === 'dev-tools' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                pluginTab === 'dev-tools'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
              }`}
            >
              <Wrench className="w-4 h-4 flex-shrink-0" />
              Dev Tools
            </button>
            {/* Dev Tools sub-tabs */}
            {pluginTab === 'dev-tools' && (
              <>
                <div className="ml-4 space-y-0.5">
                  {devToolsItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setDevToolsTab(item.id as DevToolsTab)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                        devToolsTab === item.id
                          ? 'bg-primary/10 text-foreground/80'
                          : 'text-muted-foreground/60 hover:bg-secondary/40 hover:text-foreground/70'
                      }`}
                    >
                      {item.icon && <item.icon className="w-3.5 h-3.5 flex-shrink-0" />}
                      {item.label}
                    </button>
                  ))}
                </div>
                {activeProject && (
                  <div className="mx-1 mt-2 px-3 py-2 rounded-lg bg-secondary/20 border border-primary/10">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-0.5">Active Project</p>
                    <p className="typo-caption text-foreground/70 truncate">{activeProject.name}</p>
                    {activeProject.root_path && (
                      <p className="text-[10px] text-muted-foreground/40 truncate mt-0.5">{activeProject.root_path}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Doc Signing */}
        {enabledPlugins.has('doc-signing') && (
          <button
            onClick={() => setPluginTab('doc-signing')}
            aria-current={pluginTab === 'doc-signing' ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              pluginTab === 'doc-signing'
                ? 'bg-primary/10 text-foreground/90'
                : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <FileSignature className="w-4 h-4 flex-shrink-0" />
            Doc Signing
          </button>
        )}

        {/* Obsidian Brain */}
        {enabledPlugins.has('obsidian-brain') && (
          <button
            onClick={() => setPluginTab('obsidian-brain')}
            aria-current={pluginTab === 'obsidian-brain' ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              pluginTab === 'obsidian-brain'
                ? 'bg-primary/10 text-foreground/90'
                : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <Brain className="w-4 h-4 flex-shrink-0" />
            Obsidian Brain
          </button>
        )}

        {/* OCR */}
        {enabledPlugins.has('ocr') && (
          <button
            onClick={() => setPluginTab('ocr')}
            aria-current={pluginTab === 'ocr' ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              pluginTab === 'ocr'
                ? 'bg-primary/10 text-foreground/90'
                : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <ScanLine className="w-4 h-4 flex-shrink-0" />
            OCR
          </button>
        )}
      </div>
    </div>
  );
}
