/**
 * Plugins sidebar — Level 2 + Level 3 push pane.
 *
 * Layout contract:
 * - L2: alphabetical list of every enabled plugin (Browse pinned in by
 *   alphabet, no longer special-cased to the top). Each plugin is a single
 *   row with its icon, label, and any compact status indicator (running
 *   dot, missing-twin dot).
 * - L3: when `pluginTab` is a plugin that owns sub-items (Artist / Dev
 *   Tools / Twin / Companion / Research Lab), the sidebar slides into a
 *   Level 3 pane via {@link SidebarLevel3}. The L3 header shows
 *   "← Plugins" plus an optional context chip (active project for Dev
 *   Tools, active twin for Twin). The body is the plugin's sub-tab list.
 * - Plugins without sub-items (Browse, Brain, Drive, Langfuse) stay flat
 *   on L2 — clicking them just sets `pluginTab` and the page renders the
 *   plugin's own surface.
 *
 * Mirrors the Home → Roadmap L3 pattern landed earlier in the same
 * change. See {@link SidebarLevel3} for the primitive.
 */
import { AnimatePresence } from 'framer-motion';
import { Puzzle, Palette, Brain, BookOpen, Wrench, HardDrive, Sparkles, Bot, LineChart, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import type { ArtistTab, DevToolsTab, TwinTab, PluginTab, ResearchLabTab, ObsidianBrainTab } from '@/lib/types/types';
import type { CompanionPluginTab } from '@/stores/slices/system/companionPluginSlice';
import { artistItems, companionItems, devToolsItems, obsidianBrainItems, researchLabItems, twinItems } from '../sidebarData';
import { useTranslation } from '@/i18n/useTranslation';
import SidebarLevel3, { type SidebarLevel3Item } from '../SidebarLevel3';

interface PluginMeta {
  id: PluginTab;
  label: string;
  icon: LucideIcon;
  /** True when clicking this plugin should push to L3 with its sub-items. */
  hasSubItems: boolean;
}

const PLUGINS_WITH_SUBITEMS = new Set<PluginTab>([
  'artist', 'dev-tools', 'obsidian-brain', 'twin', 'companion', 'research-lab',
]);

export function PluginsSidebarNav() {
  const { t } = useTranslation();
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
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore((s) => s.projects);
  const creativeSessionRunning = useSystemStore((s) => s.creativeSessionRunning);
  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
  const activeTwin = activeTwinId ? twinProfiles.find((tw) => tw.id === activeTwinId) : null;

  // Plugin catalog sorted alphabetically by translated label. Browse is
  // included in the alphabetical sort rather than pinned — the user asked
  // for "sort items by name asc" with no carve-outs.
  const sortedPlugins = useMemo<PluginMeta[]>(() => {
    const meta: PluginMeta[] = [
      { id: 'browse',          label: 'Browse',                              icon: Puzzle,    hasSubItems: false },
      { id: 'artist',          label: 'Artist',                              icon: Palette,   hasSubItems: true },
      { id: 'dev-tools',       label: t.shared.sidebar_extra.dev_tools_label, icon: Wrench,   hasSubItems: true },
      { id: 'obsidian-brain',  label: t.shared.sidebar_extra.obsidian_brain,  icon: Brain,    hasSubItems: true },
      { id: 'drive',           label: 'Drive',                               icon: HardDrive, hasSubItems: false },
      { id: 'twin',            label: 'Twin',                                icon: Sparkles,  hasSubItems: true },
      { id: 'companion',       label: 'Companion',                           icon: Bot,       hasSubItems: true },
      { id: 'research-lab',    label: t.shared.sidebar_extra.research_lab,    icon: BookOpen, hasSubItems: true },
      { id: 'langfuse',        label: 'Langfuse',                            icon: LineChart, hasSubItems: false },
    ];
    return meta
      .filter((p) => p.id === 'browse' || enabledPlugins.has(p.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [t, enabledPlugins]);

  const isL3 = PLUGINS_WITH_SUBITEMS.has(pluginTab) && enabledPlugins.has(pluginTab);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {isL3 ? (
        <PluginL3
          key={`plugin-l3-${pluginTab}`}
          plugin={pluginTab}
          onBack={() => setPluginTab('browse')}
          backLabel={t.shared.sidebar_extra.back_to_plugins}
          artistTab={artistTab}
          setArtistTab={setArtistTab}
          devToolsTab={devToolsTab}
          setDevToolsTab={setDevToolsTab}
          obsidianBrainTab={obsidianBrainTab}
          setObsidianBrainTab={setObsidianBrainTab}
          twinTab={twinTab}
          setTwinTab={setTwinTab}
          companionPluginTab={companionPluginTab}
          setCompanionPluginTab={setCompanionPluginTab}
          researchLabTab={researchLabTab}
          setResearchLabTab={setResearchLabTab}
          activeProjectName={activeProject?.name ?? null}
          activeTwinName={activeTwin?.name ?? null}
          fleetWaitingCount={fleetWaitingCount}
          pendingConflicts={pendingConflicts}
        />
      ) : (
        <div key="plugin-l2" className="flex flex-col h-full">
          <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto" role="tablist" aria-label="Plugins">
            {sortedPlugins.map((plugin) => {
              const Icon = plugin.icon;
              const isActive = pluginTab === plugin.id;
              const showArtistRunning = plugin.id === 'artist' && creativeSessionRunning;
              const showTwinMissing = plugin.id === 'twin' && !activeTwin && twinProfiles.length === 0 && pluginTab === 'twin';
              return (
                <button
                  key={plugin.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setPluginTab(plugin.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{plugin.label}</span>
                  {showArtistRunning && (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inset-0 rounded-full animate-ping bg-orange-500/40" />
                      <span className="relative w-2.5 h-2.5 rounded-full bg-orange-500 border border-orange-600/50" />
                    </span>
                  )}
                  {showTwinMissing && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      )}
    </AnimatePresence>
  );
}

// ─── L3 pane ────────────────────────────────────────────────────────────

interface PluginL3Props {
  plugin: PluginTab;
  onBack: () => void;
  backLabel: string;
  artistTab: ArtistTab;
  setArtistTab: (tab: ArtistTab) => void;
  devToolsTab: DevToolsTab;
  setDevToolsTab: (tab: DevToolsTab) => void;
  obsidianBrainTab: ObsidianBrainTab;
  setObsidianBrainTab: (tab: ObsidianBrainTab) => void;
  twinTab: TwinTab;
  setTwinTab: (tab: TwinTab) => void;
  companionPluginTab: CompanionPluginTab;
  setCompanionPluginTab: (tab: CompanionPluginTab) => void;
  researchLabTab: ResearchLabTab;
  setResearchLabTab: (tab: ResearchLabTab) => void;
  activeProjectName: string | null;
  activeTwinName: string | null;
  fleetWaitingCount: number;
  pendingConflicts: number;
}

function PluginL3(props: PluginL3Props) {
  const { plugin, onBack, backLabel } = props;

  const items: SidebarLevel3Item[] = useMemo(() => {
    switch (plugin) {
      case 'artist':
        return artistItems.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
        }));
      case 'dev-tools':
        return devToolsItems.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          rightSlot: item.id === 'fleet' && props.fleetWaitingCount > 0 ? (
            <span
              data-testid="fleet-sidebar-waiting-badge"
              className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-500/25 text-violet-200 typo-caption font-bold border border-violet-500/40 animate-pulse"
              title={`${props.fleetWaitingCount} session${props.fleetWaitingCount === 1 ? '' : 's'} awaiting input`}
            >
              {props.fleetWaitingCount}
            </span>
          ) : null,
        }));
      case 'obsidian-brain':
        return obsidianBrainItems.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          rightSlot: item.id === 'sync' && props.pendingConflicts > 0 ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 typo-caption font-medium border border-amber-500/30">
              {props.pendingConflicts}
            </span>
          ) : null,
        }));
      case 'twin':
        return twinItems.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
        }));
      case 'companion':
        return companionItems.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
        }));
      case 'research-lab':
        return researchLabItems.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
        }));
      default:
        return [];
    }
  }, [plugin, props.fleetWaitingCount, props.pendingConflicts]);

  const activeId = pickActiveId(plugin, props);
  const onSelect = pickSelectHandler(plugin, props);

  const subHeader = renderSubHeader(plugin, props.activeProjectName, props.activeTwinName);

  return (
    <SidebarLevel3
      backLabel={backLabel}
      onBack={onBack}
      items={items}
      activeId={activeId}
      onSelect={onSelect}
      ariaLabel={plugin}
      subHeader={subHeader}
    />
  );
}

function pickActiveId(plugin: PluginTab, p: PluginL3Props): string {
  switch (plugin) {
    case 'artist':         return p.artistTab;
    case 'dev-tools':      return p.devToolsTab;
    case 'obsidian-brain': return p.obsidianBrainTab;
    case 'twin':           return p.twinTab;
    case 'companion':      return p.companionPluginTab;
    case 'research-lab':   return p.researchLabTab;
    default:               return '';
  }
}

function pickSelectHandler(plugin: PluginTab, p: PluginL3Props): (id: string) => void {
  switch (plugin) {
    case 'artist':         return (id) => p.setArtistTab(id as ArtistTab);
    case 'dev-tools':      return (id) => p.setDevToolsTab(id as DevToolsTab);
    case 'obsidian-brain': return (id) => p.setObsidianBrainTab(id as ObsidianBrainTab);
    case 'twin':           return (id) => p.setTwinTab(id as TwinTab);
    case 'companion':      return (id) => p.setCompanionPluginTab(id as CompanionPluginTab);
    case 'research-lab':   return (id) => p.setResearchLabTab(id as ResearchLabTab);
    default:               return () => {};
  }
}

function renderSubHeader(plugin: PluginTab, activeProjectName: string | null, activeTwinName: string | null) {
  if (plugin === 'dev-tools' && activeProjectName) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary typo-caption font-medium truncate max-w-full">
        {activeProjectName}
      </span>
    );
  }
  if (plugin === 'twin' && activeTwinName) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary typo-caption font-medium truncate max-w-full">
        {activeTwinName}
      </span>
    );
  }
  return null;
}
