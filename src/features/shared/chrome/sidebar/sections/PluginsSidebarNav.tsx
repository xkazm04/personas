/**
 * Plugins sidebar — Level 2, grouped.
 *
 * Layout contract (unified with Projects / Overview / Connections on
 * 2026-07-27 — see {@link SidebarGroupNav}):
 * - **Browse** is the lead row: the plugin manager, not a plugin.
 * - Every enabled plugin below it is a **group**, whose header row is the
 *   plugin itself and whose nested rail holds that plugin's sub-tabs. The
 *   sub-tabs of the ACTIVE plugin are shown; the others collapse to just
 *   their header, so the list stays scannable at ~8 plugins.
 * - Plugins with no sub-tabs (Drive, Scraper) render as a header-only group.
 *
 * This replaces the old Level-3 push pane: the sub-tabs used to slide the
 * whole panel sideways behind a "← Plugins" back button, which hid the rest
 * of the plugin list.
 *
 * Sub-tab ids are namespaced (`<plugin>:<tab>`) because several plugins reuse
 * the same tab id (`setup`, `graph`, `knowledge`) and they now share one nav.
 */
import { Puzzle, Palette, Brain, BookOpen, Wrench, HardDrive, Sparkles, Bot, Globe, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useCompanionStore } from "@/features/plugins/companion/companionStore";
import type { ArtistTab, DevToolsTab, TwinTab, PluginTab, ResearchLabTab, ObsidianBrainTab } from '@/lib/types/types';
import type { CompanionPluginTab } from '@/stores/slices/system/companionPluginSlice';
import { artistItems, companionItems, devToolsItems, filterByTier, obsidianBrainItems, researchLabItems, twinItems } from '@/features/shared/chrome/sidebar/sidebarData';
import type { SubNavItem } from '@/features/shared/chrome/sidebar/SidebarSubNav';
import SidebarGroupNav, { type GroupNavItem, type SidebarNavGroup } from '@/features/shared/chrome/sidebar/SidebarGroupNav';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';
import { PLUGIN_ICONS } from '@/features/plugins/PluginIcons';

interface PluginMeta {
  id: PluginTab;
  label: string;
  icon: LucideIcon;
  /**
   * In-development plugins. Hidden from production builds entirely; in DEV
   * they appear in the list only (never in Browse), styled with a golden
   * border so the developer remembers they're not shipped.
   */
  devOnly?: boolean;
}

/** Running/pending pulse dot shared by the plugin rows. */
function PulseDot({ color, ping, title }: { color: string; ping: string; title?: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5" title={title}>
      <span className={`absolute inset-0 rounded-full animate-ping ${ping}`} />
      <span className={`relative w-2.5 h-2.5 rounded-full ${color}`} />
    </span>
  );
}

export function PluginsSidebarNav() {
  const { t, tx } = useTranslation();
  const pluginTab = useSystemStore((s) => s.pluginTab);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const artistTab = useSystemStore((s) => s.artistTab);
  const setArtistTab = useSystemStore((s) => s.setArtistTab);
  const devToolsTab = useSystemStore((s) => s.devToolsTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const researchLabTab = useSystemStore((s) => s.researchLabTab);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
  const obsidianBrainTab = useSystemStore((s) => s.obsidianBrainTab);
  const setObsidianBrainTab = useSystemStore((s) => s.setObsidianBrainTab);
  const pendingConflicts = useSystemStore((s) => s.obsidianPendingConflicts);
  const twinTab = useSystemStore((s) => s.twinTab);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const companionPluginTab = useSystemStore((s) => s.companionPluginTab);
  const setCompanionPluginTab = useSystemStore((s) => s.setCompanionPluginTab);
  const fleetSessions = useSystemStore((s) => s.fleetSessions);
  const fleetWaitingCount = fleetSessions.filter((s) => s.state === 'awaiting_input').length;
  const companionApprovalsCount = useCompanionStore((s) => s.approvals.length);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore((s) => s.projects);
  const creativeSessionRunning = useSystemStore((s) => s.creativeSessionRunning);
  const studioJobActive = useSystemStore((s) => s.studioJobActive);
  const revitalizeRunning = useSystemStore((s) => s.obsidianRevitalizeRunning);
  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);
  const tier = useTier();

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
  const activeTwin = activeTwinId ? twinProfiles.find((tw) => tw.id === activeTwinId) : null;

  // Plugin catalog. Browse is a management surface, not a plugin itself, so it
  // stays pinned at the top; the enabled plugins below it are sorted
  // alphabetically by translated label.
  const allPlugins = useMemo<PluginMeta[]>(() => [
    { id: 'browse',          label: 'Browse',                              icon: Puzzle },
    { id: 'artist',          label: 'Artist',                              icon: Palette,   devOnly: true },
    { id: 'dev-tools',       label: t.shared.sidebar_extra.dev_tools_label, icon: Wrench },
    { id: 'obsidian-brain',  label: t.shared.sidebar_extra.obsidian_brain,  icon: Brain },
    { id: 'drive',           label: 'Drive',                               icon: HardDrive },
    { id: 'twin',            label: 'Twin',                                icon: Sparkles },
    { id: 'companion',       label: 'Companion',                           icon: Bot },
    { id: 'research-lab',    label: t.shared.sidebar_extra.research_lab,    icon: BookOpen,  devOnly: true },
    { id: 'scraper',         label: 'Scraper',                             icon: Globe,     devOnly: true },
  ], [t]);

  const browseMeta = allPlugins.find((p) => p.id === 'browse')!;
  const sortedPlugins = useMemo<PluginMeta[]>(
    () => allPlugins
      .filter((p) => p.id !== 'browse' && enabledPlugins.has(p.id) && (!p.devOnly || import.meta.env.DEV))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [allPlugins, enabledPlugins],
  );

  // Honor the declared gating fields on sub-items — before this they were
  // silently dropped by the L3 mapping, making `minTier`/`devOnly` dead fields.
  const gate = <T extends { minTier?: import('@/lib/constants/uiModes').Tier; devOnly?: boolean }>(
    list: readonly T[],
  ): T[] => filterByTier([...list], tier.current).filter((i) => !i.devOnly || import.meta.env.DEV);

  const subItemsFor = (plugin: PluginTab): SubNavItem[] => {
    switch (plugin) {
      case 'artist':         return gate(artistItems);
      case 'dev-tools':      return gate(devToolsItems);
      case 'obsidian-brain': return gate(obsidianBrainItems);
      case 'twin':           return gate(twinItems);
      case 'companion':      return gate(companionItems);
      case 'research-lab':   return gate(researchLabItems);
      default:               return [];
    }
  };

  const activeSubTab = (plugin: PluginTab): string => {
    switch (plugin) {
      case 'artist':         return artistTab;
      case 'dev-tools':      return devToolsTab;
      case 'obsidian-brain': return obsidianBrainTab;
      case 'twin':           return twinTab;
      case 'companion':      return companionPluginTab;
      case 'research-lab':   return researchLabTab;
      default:               return '';
    }
  };

  const selectSubTab = (plugin: PluginTab, id: string) => {
    switch (plugin) {
      case 'artist':         setArtistTab(id as ArtistTab); break;
      case 'dev-tools':      setDevToolsTab(id as DevToolsTab); break;
      case 'obsidian-brain': setObsidianBrainTab(id as ObsidianBrainTab); break;
      case 'twin':           setTwinTab(id as TwinTab); break;
      case 'companion':      setCompanionPluginTab(id as CompanionPluginTab); break;
      case 'research-lab':   setResearchLabTab(id as ResearchLabTab); break;
      default: break;
    }
  };

  /** Right-edge adornment for a plugin's header row (counts + running dots). */
  const headerRightSlot = (plugin: PluginMeta) => {
    if (plugin.id === 'dev-tools' && fleetWaitingCount > 0) {
      return (
        <span
          data-testid="devtools-l2-waiting-badge"
          className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-500/25 text-violet-200 typo-caption font-bold border border-violet-500/40 animate-pulse"
          title={fleetWaitingCount === 1
            ? tx(t.plugins.fleet.needs_input_one, { count: fleetWaitingCount })
            : tx(t.plugins.fleet.needs_input_other, { count: fleetWaitingCount })}
        >
          {fleetWaitingCount}
        </span>
      );
    }
    if (plugin.id === 'companion' && companionApprovalsCount > 0) {
      return (
        <span
          data-testid="companion-l2-approvals-badge"
          className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 typo-caption font-bold border border-amber-500/40"
          title={companionApprovalsCount === 1
            ? tx(t.plugins.fleet.approvals_pending_one, { count: companionApprovalsCount })
            : tx(t.plugins.fleet.approvals_pending_other, { count: companionApprovalsCount })}
        >
          {companionApprovalsCount}
        </span>
      );
    }
    if (plugin.id === 'artist' && creativeSessionRunning) {
      return <PulseDot color="bg-orange-500 border border-orange-600/50" ping="bg-orange-500/40" />;
    }
    if (plugin.id === 'twin' && studioJobActive) {
      return <PulseDot color="bg-violet-500 border border-violet-600/50" ping="bg-violet-500/40" title={t.twin.studioInProgress} />;
    }
    if (plugin.id === 'obsidian-brain' && revitalizeRunning) {
      return <PulseDot color="bg-fuchsia-500 border border-fuchsia-600/50" ping="bg-fuchsia-500/40" title={t.plugins.obsidian_brain.revitalize_badge_running} />;
    }
    if (plugin.devOnly) {
      return (
        <span
          className="px-1.5 py-0.5 rounded-full typo-caption font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/40 uppercase tracking-wide"
          aria-label={debtText("auto_in_development_f6146d71")}
        >
          Dev
        </span>
      );
    }
    return null;
  };

  /** Right-edge adornment for a plugin sub-tab row. */
  const subItemRightSlot = (plugin: PluginTab, id: string) => {
    if (plugin === 'dev-tools' && id === 'fleet' && fleetWaitingCount > 0) {
      return (
        <span
          data-testid="fleet-sidebar-waiting-badge"
          className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-500/25 text-violet-200 typo-caption font-bold border border-violet-500/40 animate-pulse"
          title={fleetWaitingCount === 1
            ? tx(t.plugins.fleet.needs_input_one, { count: fleetWaitingCount })
            : tx(t.plugins.fleet.needs_input_other, { count: fleetWaitingCount })}
        >
          {fleetWaitingCount}
        </span>
      );
    }
    if (plugin === 'obsidian-brain' && id === 'sync' && pendingConflicts > 0) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 typo-caption font-medium border border-amber-500/30">
          {pendingConflicts}
        </span>
      );
    }
    if (plugin === 'obsidian-brain' && id === 'revitalize' && revitalizeRunning) {
      return <PulseDot color="bg-fuchsia-500 border border-fuchsia-600/50" ping="bg-fuchsia-500/40" title={t.plugins.obsidian_brain.revitalize_badge_running} />;
    }
    if (plugin === 'twin' && id === 'training' && studioJobActive) {
      return <PulseDot color="bg-violet-500 border border-violet-600/50" ping="bg-violet-500/40" title={t.twin.studioInProgress} />;
    }
    return null;
  };

  /**
   * Context chip that used to live in the L3 header (active Dev Tools project /
   * active Twin). Now rendered at the top of the plugin's own group rail.
   */
  const contextChip = (plugin: PluginTab) => {
    const name = plugin === 'dev-tools' ? activeProject?.name : plugin === 'twin' ? activeTwin?.name : null;
    if (!name) return null;
    return (
      <div className="px-2.5 pb-1">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary typo-caption font-medium truncate max-w-full">
          {name}
        </span>
      </div>
    );
  };

  const groups: SidebarNavGroup[] = sortedPlugins.map((plugin) => {
    const isActive = pluginTab === plugin.id;
    const CustomIcon = PLUGIN_ICONS[plugin.id];
    const HeaderIcon: LucideIcon = CustomIcon
      ? ((({ className }: { className?: string }) => <CustomIcon active={isActive} className={className} />) as unknown as LucideIcon)
      : plugin.icon;
    return {
      id: plugin.id,
      groupItem: {
        id: plugin.id,
        label: plugin.label,
        icon: HeaderIcon,
        dev: plugin.devOnly,
        title: plugin.devOnly ? `${plugin.label} — in development (dev builds only)` : undefined,
        rightSlot: headerRightSlot(plugin),
        onSelect: () => setPluginTab(plugin.id),
      },
      render: isActive ? contextChip(plugin.id) : null,
      items: (isActive ? subItemsFor(plugin.id) : []).map<GroupNavItem>((item) => ({
        id: `${plugin.id}:${item.id}`,
        label: item.label,
        icon: item.icon,
        rightSlot: subItemRightSlot(plugin.id, item.id),
        onSelect: () => selectSubTab(plugin.id, item.id),
      })),
    };
  });

  const activeId = pluginTab === 'browse'
    ? 'browse'
    : activeSubTab(pluginTab)
      ? `${pluginTab}:${activeSubTab(pluginTab)}`
      : pluginTab;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 px-2 py-2 overflow-y-auto">
        <SidebarGroupNav
          ariaLabel={t.sidebar.plugins}
          lead={{
            id: 'browse',
            label: browseMeta.label,
            icon: browseMeta.icon,
            onSelect: () => setPluginTab('browse'),
          }}
          groups={groups}
          activeId={activeId}
          onSelect={() => {}}
        />
      </div>
    </div>
  );
}
