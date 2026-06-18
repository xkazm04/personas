import { useCallback, useEffect, useState, useMemo } from 'react';
import { Key, Sparkles, CalendarClock } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useWhatsNewIndicator } from '@/hooks/sidebar/useWhatsNewIndicator';
// useBadgeCounts removed — badge counts now passed as props from Sidebar
import type { HomeTab, OverviewTab, TemplateTab, SettingsTab, EventBusTab } from '@/lib/types/types';
import { useCredentialNav, type CredentialNavKey } from '@/features/vault/shared/hooks/CredentialNavContext';

import SidebarSubNav from '@/features/shared/chrome/sidebar/SidebarSubNav';
import type { SubNavBadge, SubNavIndicator } from '@/features/shared/chrome/sidebar/SidebarSubNav';
import {
  homeItems, overviewItems, credentialItems, templateItems,
  eventBusItems, getSettingsItems,
} from '@/features/shared/chrome/sidebar/sidebarData';
import { SETTINGS_ICON_ACCENTS } from '@/lib/design/statusTokens';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { filterByTier } from '@/features/shared/chrome/sidebar/sidebarData';
import { AgentsSidebarNav } from '@/features/shared/chrome/sidebar/sections/AgentsSidebarNav';
import TeamsSidebarNav from '@/features/shared/chrome/sidebar/sections/TeamsSidebarNav';
import { PluginsSidebarNav } from '@/features/shared/chrome/sidebar/sections/PluginsSidebarNav';
import { useTranslation } from '@/i18n/useTranslation';
import { useSidebarLabels } from '@/i18n/useSidebarTranslation';
import type { SubNavItem } from '@/features/shared/chrome/sidebar/SidebarSubNav';

interface SidebarLevel2Props {
  onCreatePersona: () => void;
  pendingReviewCount?: number;
  unreadMessageCount?: number;
  pendingEventCount?: number;
  directorAttentionCount?: number;
}

export default function SidebarLevel2({ onCreatePersona, pendingReviewCount = 0, unreadMessageCount = 0, pendingEventCount = 0, directorAttentionCount = 0 }: SidebarLevel2Props) {
  const { t } = useTranslation();
  const labelOf = useSidebarLabels();
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
  const { hasUpdate: whatsNewUpdate } = useWhatsNewIndicator();
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
  if (directorAttentionCount > 0) overviewBadges['director'] = { count: directorAttentionCount, className: 'bg-violet-500/20 text-violet-400 border border-violet-500/30' };

  const credentialBadges: Record<string, SubNavBadge> = {
    credentials: { count: credentials.length, className: 'bg-secondary/50 border border-primary/10 text-foreground font-normal' },
    databases: { count: dbCredCount, className: 'bg-secondary/50 border border-primary/10 text-foreground font-normal' },
    'from-template': { count: templateCount, className: 'bg-secondary/50 border border-primary/10 text-foreground font-normal' },
  };

  const settingsItems = getSettingsItems(isDev, tier.current);

  // L2 lists for Overview / Goals / Events / Connections / Templates / Settings
  // are presented alphabetically by the label the user actually sees. We sort
  // on the resolved label (respecting any labelOverrides + locale ordering)
  // rather than the raw English `label`, so translated sidebars stay sorted.
  const sortByLabel = <T extends { id: string; label: string }>(
    list: T[],
    overrides?: Record<string, string>,
  ): T[] =>
    [...list].sort((a, b) =>
      (overrides?.[a.id] ?? labelOf(a.id, a.label)).localeCompare(
        overrides?.[b.id] ?? labelOf(b.id, b.label),
      ),
    );
  // Connections is alphabetical too, but the "Add new" action is pinned to the
  // bottom regardless of its label.
  const sortCredentialItems = (list: SubNavItem[]): SubNavItem[] => {
    const pinned = list.filter((i) => i.id === 'add-new');
    const rest = list.filter((i) => i.id !== 'add-new');
    return [...sortByLabel(rest), ...pinned];
  };

  switch (sidebarSection) {
    case 'home': {
      // The release picker used to push a Level 3 pane over this list; it now
      // lives as a left rail inside the "What's New" content (ReleaseNavRail),
      // so the home L2 list always stays visible. A dot on Roadmap nudges the
      // user toward release notes after an app update — selecting it opens the
      // page, which acknowledges the version and clears the dot.
      const homeIndicators: Record<string, SubNavIndicator> = whatsNewUpdate
        ? { roadmap: { color: 'bg-cyan-400 border border-cyan-500/50', label: t.shared.sidebar_extra.whats_new_update, pulse: true } }
        : {};
      return (
        <div className="flex flex-col h-full">
          <SidebarSubNav
            items={homeItems}
            activeId={homeTab}
            onSelect={(id) => setHomeTab(id as HomeTab)}
            indicators={homeIndicators}
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
      );
    }

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
          items={sortByLabel(filterSimple(visibleOverviewItems), { home: t.sidebar.mission_control })}
          activeId={overviewTab}
          onSelect={(id) => setOverviewTab(id as OverviewTab)}
          badges={overviewBadges}
          variant="overview"
          devItems={overviewDevSet}
          // The overview dashboard tab's id is 'home', which collides with the
          // top-level 'home' section in the shared sidebar label map (both
          // resolve to t.sidebar.home = "Home"). Override it here so this tab
          // reads "Mission control" without renaming the top-level section.
          labelOverrides={{ home: t.sidebar.mission_control }}
        />
      );
    }

    case 'teams':
      return <TeamsSidebarNav />;

    case 'personas':
      return <AgentsSidebarNav onCreatePersona={onCreatePersona} />;

    case 'events': {
      const visibleEventItems = isDev ? eventBusItems : eventBusItems.filter(i => !i.devOnly);
      const eventDevSet = isDev ? new Set(eventBusItems.filter(i => i.devOnly).map(i => i.id)) : undefined;
      return (
        <SidebarSubNav
          items={sortByLabel(visibleEventItems)}
          activeId={eventBusTab}
          onSelect={(id) => setEventBusTab(id as EventBusTab)}
          devItems={eventDevSet}
        />
      );
    }

    case 'credentials':
      return (
        <SidebarSubNav
          items={sortCredentialItems(filterSimple(credentialItems))}
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
          items={sortByLabel(filterSimple(templateItems))}
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
          items={sortByLabel(settingsItems)}
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
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const [cronAgents, setCronAgents] = useState<{ persona_id: string; persona_name: string }[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  useEffect(() => { void fetchTeams(); }, [fetchTeams]);

  useEffect(() => {
    void import('@/stores/overviewStore').then(({ useOverviewStore }) => {
      let prev = useOverviewStore.getState().cronAgents;
      setCronAgents(prev);
      return useOverviewStore.subscribe((s) => {
        if (s.cronAgents !== prev) { prev = s.cronAgents; setCronAgents(s.cronAgents); }
      });
    }).then((unsub) => { return () => unsub?.(); });
  }, []);

  // Group scheduled personas by their home team; everything without a team
  // collapses into a single "No team" bucket. Counts are schedules (not
  // personas) so the sidebar numbers line up with the calendar's "X total".
  const groups = useMemo(() => {
    const countByPersona = new Map<string, number>();
    for (const a of cronAgents) {
      countByPersona.set(a.persona_id, (countByPersona.get(a.persona_id) ?? 0) + 1);
    }
    const teamById = new Map(teams.map((tm) => [tm.id, tm] as const));
    const byBucket = new Map<string, string[]>();
    for (const p of personas) {
      if (!countByPersona.has(p.id)) continue;
      const key = p.home_team_id && teamById.has(p.home_team_id) ? p.home_team_id : '__ungrouped__';
      const bucket = byBucket.get(key) ?? [];
      bucket.push(p.id);
      byBucket.set(key, bucket);
    }
    const sumSchedules = (ids: string[]) => ids.reduce((sum, id) => sum + (countByPersona.get(id) ?? 0), 0);
    const out: { id: string; name: string; color: string | null; personaIds: string[]; scheduleCount: number }[] = [];
    for (const tm of [...teams].sort((a, b) => a.name.localeCompare(b.name))) {
      const ids = byBucket.get(tm.id);
      if (!ids || ids.length === 0) continue;
      out.push({ id: tm.id, name: tm.name, color: tm.color, personaIds: ids, scheduleCount: sumSchedules(ids) });
    }
    const ungrouped = byBucket.get('__ungrouped__');
    if (ungrouped && ungrouped.length > 0) {
      out.push({ id: '__ungrouped__', name: t.shared.sidebar_extra.no_team, color: null, personaIds: ungrouped, scheduleCount: sumSchedules(ungrouped) });
    }
    return out;
  }, [cronAgents, personas, teams, t]);

  // Broadcast the group filter to ScheduleTimeline via a custom event. The
  // detail carries the set of persona ids in the group plus a display label.
  const selectFilter = useCallback((groupId: string | null, personaIds: string[] | null, label: string) => {
    setSelectedGroupId(groupId);
    window.dispatchEvent(new CustomEvent('schedules:filter', { detail: { personaIds, label } }));
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
        {/* All schedules */}
        <button
          onClick={() => selectFilter(null, null, '')}
          aria-current={selectedGroupId === null ? 'page' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
            selectedGroupId === null
              ? 'bg-primary/10 text-foreground font-semibold'
              : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
          }`}
        >
          <CalendarClock className="w-4 h-4 flex-shrink-0" />
          {t.shared.sidebar_extra.all_personas}
          <span className="ml-auto text-[10px] font-mono text-foreground/90">{cronAgents.length}</span>
        </button>

        {/* Divider */}
        {groups.length > 0 && (
          <div className="mx-2 my-1.5 border-t border-primary/8" />
        )}

        {/* Team groups + a "No team" bucket, sorted by team name */}
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => selectFilter(g.id, g.personaIds, g.name)}
            aria-current={selectedGroupId === g.id ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              selectedGroupId === g.id
                ? 'bg-primary/10 text-foreground font-semibold'
                : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
            }`}
          >
            <span
              className="flex-shrink-0 w-2 h-2 rounded-full"
              style={{ backgroundColor: g.color ?? '#6b7280' }}
              aria-hidden
            />
            <span className="truncate text-[13px] min-w-0">{g.name}</span>
            <span className="ml-auto text-[10px] font-mono text-foreground/90 tabular-nums">{g.scheduleCount}</span>
          </button>
        ))}

        {/* Empty state */}
        {groups.length === 0 && (
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

// The Home → "What's New" release picker used to live here as a Level 3 push
// pane (HomeRoadmapL3). It moved into the content area as `ReleaseNavRail`
// (src/features/home/sub_releases/) on 2026-06-09 so the home L2 list stays
// visible; selection + sessionStorage persistence now live in
// `sub_releases/releaseSelection.ts`.

