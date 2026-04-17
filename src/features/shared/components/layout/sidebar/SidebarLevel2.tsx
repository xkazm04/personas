import { useCallback, useEffect, useState, useMemo } from 'react';
import { Key, Sparkles, CalendarClock } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
// useBadgeCounts removed — badge counts now passed as props from Sidebar
import type { HomeTab, OverviewTab, TemplateTab, SettingsTab, EventBusTab } from '@/lib/types/types';
import { useCredentialNav, type CredentialNavKey } from '@/features/vault/shared/hooks/CredentialNavContext';
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';

import SidebarSubNav from './SidebarSubNav';
import type { SubNavBadge } from './SidebarSubNav';
import {
  homeItems, overviewItems, credentialItems, templateItems,
  eventBusItems, getSettingsItems,
} from './sidebarData';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { filterByTier } from './sidebarData';
import { AgentsSidebarNav } from './sections/AgentsSidebarNav';
import { PluginsSidebarNav } from './sections/PluginsSidebarNav';
import { useTranslation } from '@/i18n/useTranslation';

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
    credentials: { count: credentials.length, className: 'bg-secondary/50 border border-primary/10 text-foreground font-normal' },
    databases: { count: dbCredCount, className: 'bg-secondary/50 border border-primary/10 text-foreground font-normal' },
    'from-template': { count: templateCount, className: 'bg-secondary/50 border border-primary/10 text-foreground font-normal' },
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
              <p className="typo-body text-foreground/90">{t.shared.sidebar_extra.no_credentials}</p>
              <Button
                variant="accent"
                accentColor="violet"
                size="md"
                icon={<Sparkles className="w-3 h-3" />}
                onClick={() => useProvisioningWizardStore.getState().open(true)}
              >
                {t.shared.sidebar_extra.ai_setup_wizard}
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
        />
      );


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
          devItems={isDev ? new Set(['engine', 'byom', 'network', 'quality-gates', 'config', 'admin']) : undefined}
        />
      );

    default:
      return null;
  }
}

// -- Schedules persona filter sidebar --

function SchedulesSidebarNav() {
  const { t } = useTranslation();
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
          <span className="typo-label text-foreground/90">{t.shared.sidebar_extra.schedules}</span>
          <span className="text-[10px] font-mono text-foreground/90">{cronAgents.length} total</span>
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
              : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
          }`}
        >
          <CalendarClock className="w-4 h-4 flex-shrink-0" />
          {t.shared.sidebar_extra.all_personas}
          <span className="ml-auto text-[10px] font-mono text-foreground/90">{scheduledPersonas.length}</span>
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
                : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <PersonaIcon icon={p.icon} color={p.color} />
            <span className="truncate text-[13px] min-w-0">{p.name}</span>
            <span className="ml-auto text-[10px] font-mono text-foreground/90 tabular-nums">{p.scheduleCount}</span>
          </button>
        ))}

        {/* Empty state */}
        {scheduledPersonas.length === 0 && (
          <div className="text-center py-10 space-y-2">
            <CalendarClock className="w-8 h-8 mx-auto text-foreground/90" />
            <p className="text-[12px] text-foreground/90">{t.shared.sidebar_extra.no_scheduled_agents}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Simplified agents sidebar (persona list removed, lives in table view now) --

// ── Health grade dot for agent sidebar items ──────────────────────────

// HEALTH_DOT moved to sections/AgentsSidebarNav.tsx

