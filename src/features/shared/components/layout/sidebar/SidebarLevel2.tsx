import { useCallback, useEffect, useState, useMemo } from 'react';
import { Key, Users, Sparkles, Plus, List, Loader2, Star, Bot, ChevronDown } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useBadgeCounts } from '@/hooks/sidebar/useBadgeCounts';
import type { HomeTab, OverviewTab, TemplateTab, CloudTab, SettingsTab, DevToolsTab, EventBusTab } from '@/lib/types/types';
import { useCredentialNav, type CredentialNavKey } from '@/features/vault/hooks/CredentialNavContext';
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';
// GroupedAgentSidebar replaced by inline AgentsSidebarNav (persona list moved to table view)
import { useFavoriteAgents as useFavoriteAgentsInline } from '@/hooks/agents/useFavoriteAgents';
import TeamDragPanel from '@/features/pipeline/components/TeamDragPanel';
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
}

export default function SidebarLevel2({ onCreatePersona }: SidebarLevel2Props) {
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  const { currentKey: credentialView, navigate } = useCredentialNav();
  // Vault and pipeline stores loaded lazily to keep them out of the main bundle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [credentials, setCredentials] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [connectorDefinitions, setConnectorDefinitions] = useState<any[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [overviewTab, setOverviewTabState] = useState<OverviewTab>("home" as OverviewTab);
  useEffect(() => {
    let vaultUnsub: (() => void) | undefined;
    let pipelineUnsub: (() => void) | undefined;
    let overviewUnsub: (() => void) | undefined;
    void import("@/stores/vaultStore").then(({ useVaultStore }) => {
      const s = useVaultStore.getState();
      setCredentials(s.credentials);
      setConnectorDefinitions(s.connectorDefinitions);
      vaultUnsub = useVaultStore.subscribe((s) => {
        setCredentials(s.credentials);
        setConnectorDefinitions(s.connectorDefinitions);
      });
    });
    void import("@/stores/pipelineStore").then(({ usePipelineStore }) => {
      setSelectedTeamId(usePipelineStore.getState().selectedTeamId);
      pipelineUnsub = usePipelineStore.subscribe((s) => setSelectedTeamId(s.selectedTeamId));
    });
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      setOverviewTabState(useOverviewStore.getState().overviewTab);
      overviewUnsub = useOverviewStore.subscribe((s) => setOverviewTabState(s.overviewTab));
    });
    return () => { vaultUnsub?.(); pipelineUnsub?.(); overviewUnsub?.(); };
  }, []);
  const setOverviewTab = useCallback((tab: OverviewTab) => {
    setOverviewTabState(tab);
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => useOverviewStore.getState().setOverviewTab(tab));
  }, []);
  const homeTab = useSystemStore((s) => s.homeTab);
  const setHomeTab = useSystemStore((s) => s.setHomeTab);
  const templateTab = useSystemStore((s) => s.templateTab);
  const setTemplateTab = useSystemStore((s) => s.setTemplateTab);
  const { pendingReviewCount, unreadMessageCount, pendingEventCount } = useBadgeCounts();
  const templateGalleryTotal = useSystemStore((s) => s.templateGalleryTotal);
  const cloudTab = useSystemStore((s) => s.cloudTab);
  const setCloudTab = useSystemStore((s) => s.setCloudTab);
  const settingsTab = useSystemStore((s) => s.settingsTab);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const devToolsTab = useSystemStore((s) => s.devToolsTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const eventBusTab = useSystemStore((s) => s.eventBusTab);
  const setEventBusTab = useSystemStore((s) => s.setEventBusTab);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore((s) => s.projects);

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

    case 'events':
      return (
        <SidebarSubNav
          items={eventBusItems}
          activeId={eventBusTab}
          onSelect={(id) => setEventBusTab(id as EventBusTab)}
        />
      );

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
              <p className="text-sm text-muted-foreground/80">No credentials yet</p>
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

    case 'design-reviews':
      return (
        <SidebarSubNav
          items={filterSimple(templateItems)}
          activeId={templateTab}
          onSelect={(id) => setTemplateTab(id as TemplateTab)}
          badges={templateGalleryTotal > 0 ? {
            generated: { count: templateGalleryTotal, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
          } : undefined}
        />
      );

    case 'team':
      if (selectedTeamId) {
        return <TeamDragPanel />;
      }
      return (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Users className="w-6 h-6 text-indigo-400/60" />
          </div>
          <p className="text-sm text-muted-foreground/80">Multi-Agent Teams</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Select a team to begin</p>
        </div>
      );

    case 'cloud':
      return (
        <SidebarSubNav
          items={cloudItems}
          activeId={cloudTab}
          onSelect={(id) => setCloudTab(id as CloudTab)}
        />
      );

    case 'dev-tools': {
      const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
      return (
        <>
          <SidebarSubNav
            items={devToolsItems}
            activeId={devToolsTab}
            onSelect={(id) => setDevToolsTab(id as DevToolsTab)}
            variant="overview"
          />
          {activeProject && (
            <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
              <p className="text-[10px] uppercase tracking-wider text-amber-400/50 font-medium mb-0.5">Active Project</p>
              <p className="text-xs text-foreground/70 font-medium truncate">{activeProject.name}</p>
              {activeProject.root_path && (
                <p className="text-[10px] text-muted-foreground/40 truncate mt-0.5">{activeProject.root_path}</p>
              )}
            </div>
          )}
        </>
      );
    }

    case 'settings':
      return (
        <SidebarSubNav
          items={settingsItems}
          activeId={settingsTab}
          onSelect={(id) => setSettingsTab(id as SettingsTab)}
          devItems={isDev ? new Set(['engine', 'byom', 'network', 'admin']) : undefined}
        />
      );

    default:
      return null;
  }
}

// -- Simplified agents sidebar (persona list removed, lives in table view now) --

function AgentsSidebarNav({ onCreatePersona }: { onCreatePersona: () => void }) {
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const personas = useAgentStore((s) => s.personas);
  const agentTab = useSystemStore((s) => s.agentTab);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);
  const isCreatingPersona = useSystemStore((s) => s.isCreatingPersona);
  const buildPersonaId = useAgentStore((s) => s.buildPersonaId);
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);

  const hasActiveBuild = !!buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted';
  const buildingPersona = hasActiveBuild ? personas.find((p) => p.id === buildPersonaId) : null;

  // Favorites from localStorage
  const { favorites, toggleFavorite } = useFavoriteAgentsInline();
  const favoritePersonas = useMemo(
    () => personas.filter((p) => favorites.has(p.id)),
    [personas, favorites],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-primary/10">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">Agents</span>
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
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
            agentTab === 'all' && !isCreatingPersona
              ? 'bg-primary/10 text-foreground/90 font-medium'
              : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
          }`}
        >
          <List className="w-4 h-4 flex-shrink-0" />
          All Agents
          <span className="ml-auto text-[11px] text-muted-foreground/40">{personas.length}</span>
        </button>

        {/* Active build indicator */}
        {hasActiveBuild && buildingPersona && (
          <button
            onClick={() => {
              useAgentStore.setState({ buildPersonaId: buildingPersona.id });
              useSystemStore.getState().setIsCreatingPersona(true);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isCreatingPersona
                ? 'bg-violet-500/10 text-violet-300 font-medium border border-violet-500/15'
                : 'text-muted-foreground/70 hover:bg-violet-500/5 hover:text-violet-300'
            }`}
          >
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-violet-400" />
            <span className="truncate">{buildingPersona.name}</span>
            <span className="ml-auto text-[10px] text-violet-400/60 capitalize">{buildPhase}</span>
          </button>
        )}

        {/* Favorites section */}
        {favoritePersonas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <button
              onClick={() => setFavoritesCollapsed(!favoritesCollapsed)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400/60 hover:text-amber-400/80 transition-colors"
            >
              <Star className="w-3 h-3 fill-amber-400/60" />
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
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors hover:bg-secondary/40 group"
                  >
                    <Bot
                      className="w-4 h-4 flex-shrink-0"
                      style={{ color: p.color ?? 'var(--primary)' }}
                    />
                    <span className="text-foreground/70 truncate text-[13px] min-w-0">{p.name}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFavorite(p.id); } }}
                      className="ml-auto flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/10 rounded cursor-pointer"
                      title="Remove from favorites"
                    >
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    </span>
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

