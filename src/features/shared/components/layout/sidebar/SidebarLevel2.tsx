import { useCallback, useEffect, useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Key, Sparkles, CalendarClock, Map as MapIcon, Rocket } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Button } from '@/features/shared/components/buttons';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
// useBadgeCounts removed — badge counts now passed as props from Sidebar
import type { HomeTab, GoalsTab, OverviewTab, TemplateTab, SettingsTab, EventBusTab } from '@/lib/types/types';
import { useCredentialNav, type CredentialNavKey } from '@/features/vault/shared/hooks/CredentialNavContext';
import { getNavReleases, RELEASE_STATUS_META, type Release } from '@/data/releases';
import { useReleasesTranslation } from '@/features/home/sub_releases/i18n/useReleasesTranslation';

import SidebarSubNav from './SidebarSubNav';
import SidebarLevel3 from './SidebarLevel3';
import type { SubNavBadge } from './SidebarSubNav';
import {
  homeItems, overviewItems, credentialItems, templateItems,
  eventBusItems, getSettingsItems, goalItems,
} from './sidebarData';
import { SETTINGS_ICON_ACCENTS } from '@/lib/design/statusTokens';
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
  const { t } = useTranslation();
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  const { currentKey: credentialView, navigate } = useCredentialNav();
  // Vault and pipeline stores loaded lazily to keep them out of the main bundle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [credentials, setCredentials] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [connectorDefinitions, setConnectorDefinitions] = useState<any[]>([]);
  // Read overview tab directly from the store so the sidebar highlight and
  // OverviewPage render from the exact same source. The previous local-state
  // mirror introduced a brittle indirection (and a memory leak under React
  // 18 strict mode) that made it possible for the highlight to advance
  // while the page content stayed stuck on the old tab.
  const overviewTab = useOverviewStore((s) => s.overviewTab);
  const setOverviewTab = useCallback((tab: OverviewTab) => {
    useOverviewStore.getState().setOverviewTab(tab);
  }, []);
  useEffect(() => {
    let vaultUnsub: (() => void) | undefined;
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
    return () => { vaultUnsub?.(); };
  }, []);
  const homeTab = useSystemStore((s) => s.homeTab);
  const setHomeTab = useSystemStore((s) => s.setHomeTab);
  const goalsTab = useSystemStore((s) => s.goalsTab);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);
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
        <AnimatePresence mode="wait" initial={false}>
          {homeTab === 'roadmap' ? (
            <HomeRoadmapL3 key="home-l3" onBack={() => setHomeTab('welcome')} />
          ) : (
            <div key="home-l2" className="flex flex-col h-full">
              <SidebarSubNav
                items={homeItems}
                activeId={homeTab}
                onSelect={(id) => setHomeTab(id as HomeTab)}
                onHoverItem={(id) => {
                  if (id === 'roadmap') void import('@/features/home/lib/prefetch').then(m => m.prefetchHomeReleases());
                  else if (id === 'learning') void import('@/features/home/lib/prefetch').then(m => m.prefetchHomeLearning());
                }}
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
            </div>
          )}
        </AnimatePresence>
      );

    case 'overview': {
      // Dev-only tabs (e.g. Incidents — no data source wired yet) are hidden
      // from production builds and rendered with a golden border in DEV so
      // they're recognizably not user-facing.
      const visibleOverviewItems = isDev ? overviewItems : overviewItems.filter((i) => !i.devOnly);
      const overviewDevSet = isDev
        ? new Set(overviewItems.filter((i) => i.devOnly).map((i) => i.id))
        : undefined;
      return (
        <SidebarSubNav
          items={filterSimple(visibleOverviewItems)}
          activeId={overviewTab}
          onSelect={(id) => setOverviewTab(id as OverviewTab)}
          badges={overviewBadges}
          variant="overview"
          devItems={overviewDevSet}
        />
      );
    }

    case 'goals':
      return (
        <SidebarSubNav
          items={goalItems}
          activeId={goalsTab}
          onSelect={(id) => setGoalsTab(id as GoalsTab)}
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
                onClick={() => navigate('add-new')}
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
          devItems={isDev ? new Set(['engine', 'byom', 'network', 'config', 'history', 'admin']) : undefined}
          accents={SETTINGS_ICON_ACCENTS}
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
              ? 'bg-primary/10 text-foreground/90 font-semibold'
              : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80 font-normal'
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
                ? 'bg-primary/10 text-foreground/90 font-semibold'
                : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80 font-normal'
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

// -- Home → "What's New" L3 push pane (release picker) --------------------

const HOME_RELEASE_STORAGE_KEY = 'home-releases-selected-version';

function persistHomeReleaseVersion(version: string): void {
  try {
    window.sessionStorage.setItem(HOME_RELEASE_STORAGE_KEY, version);
  } catch (err) {
    silentCatch('SidebarLevel2:persistHomeReleaseVersion')(err);
  }
}

function HomeRoadmapL3({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { t: releases } = useReleasesTranslation();
  const homeReleaseVersion = useSystemStore((s) => s.homeReleaseVersion);
  const setHomeReleaseVersion = useSystemStore((s) => s.setHomeReleaseVersion);
  const navReleases = useMemo(() => getNavReleases(), []);

  const items = useMemo(
    () =>
      navReleases.map((release: Release) => {
        const isRoadmap = release.status === 'roadmap';
        const releaseI18n = releases.releases[release.version as keyof typeof releases.releases];
        const label = isRoadmap
          ? releases.navBar.roadmapLabel
          : releaseI18n?.label
            ? `${releaseI18n.label} (${release.version})`
            : release.version;
        const meta = RELEASE_STATUS_META[release.status];
        const statusLabel = releases.status[release.status];
        // Status tag rendered as a secondary row beneath the release label
        // (not as a same-row rightSlot) so the row reads as
        //   "Alpha (v1.0)"
        //   "[Current]"
        // The roadmap entry has no shipping status, so it just shows the label.
        return {
          id: release.version,
          icon: isRoadmap ? MapIcon : Rocket,
          label,
          belowRow: isRoadmap ? null : (
            <span
              className={[
                'inline-flex rounded-full border px-1.5 py-0.5 typo-caption font-semibold uppercase tracking-wider',
                meta.badgeBg,
                meta.badgeText,
                meta.badgeBorder,
              ].join(' ')}
            >
              {statusLabel}
            </span>
          ),
        };
      }),
    [navReleases, releases],
  );

  const handleSelect = useCallback(
    (version: string) => {
      setHomeReleaseVersion(version);
      persistHomeReleaseVersion(version);
    },
    [setHomeReleaseVersion],
  );

  return (
    <SidebarLevel3
      backLabel={t.shared.sidebar_extra.roadmap}
      onBack={onBack}
      items={items}
      activeId={homeReleaseVersion}
      onSelect={handleSelect}
      ariaLabel={t.shared.sidebar_extra.whats_new}
    />
  );
}

