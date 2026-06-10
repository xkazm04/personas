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
 * - Plugins without sub-items (Browse, Brain, Drive) stay flat
 *   on L2 — clicking them just sets `pluginTab` and the page renders the
 *   plugin's own surface.
 *
 * Mirrors the Home → Roadmap L3 pattern landed earlier in the same
 * change. See {@link SidebarLevel3} for the primitive.
 */
import { AnimatePresence } from 'framer-motion';
import { Puzzle, Palette, Brain, BookOpen, Wrench, HardDrive, Sparkles, Bot, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useCompanionStore } from "@/features/plugins/companion/companionStore";
import type { ArtistTab, DevToolsTab, TwinTab, PluginTab, ResearchLabTab, ObsidianBrainTab } from '@/lib/types/types';
import type { CompanionPluginTab } from '@/stores/slices/system/companionPluginSlice';
import { artistItems, companionItems, devToolsItems, obsidianBrainItems, researchLabItems, twinItems } from '../sidebarData';
import { useTranslation } from '@/i18n/useTranslation';
import SidebarLevel3, { type SidebarLevel3Item } from '../SidebarLevel3';
import { debtText } from '@/i18n/DebtText';
import { PLUGIN_ICONS } from '@/features/plugins/PluginIcons';


interface PluginMeta {
  id: PluginTab;
  label: string;
  icon: LucideIcon;
  /** True when clicking this plugin should push to L3 with its sub-items. */
  hasSubItems: boolean;
  /**
   * In-development plugins. Hidden from production builds entirely; in
   * DEV they appear in the L2 list only (never in Browse), styled with
   * a golden border so the developer remembers they're not shipped.
   */
  devOnly?: boolean;
}

const PLUGINS_WITH_SUBITEMS = new Set<PluginTab>([
  'artist', 'dev-tools', 'obsidian-brain', 'twin', 'companion', 'research-lab',
]);

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
  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
  const activeTwin = activeTwinId ? twinProfiles.find((tw) => tw.id === activeTwinId) : null;

  // Plugin catalog. Browse is a management surface, not a plugin itself,
  // so it stays pinned at the top of the L2 list (rendered separately
  // below); the remaining enabled plugins are sorted alphabetically by
  // translated label.
  const allPlugins = useMemo<PluginMeta[]>(() => [
    { id: 'browse',          label: 'Browse',                              icon: Puzzle,    hasSubItems: false },
    { id: 'artist',          label: 'Artist',                              icon: Palette,   hasSubItems: true, devOnly: true },
    { id: 'dev-tools',       label: t.shared.sidebar_extra.dev_tools_label, icon: Wrench,   hasSubItems: true },
    { id: 'obsidian-brain',  label: t.shared.sidebar_extra.obsidian_brain,  icon: Brain,    hasSubItems: true },
    { id: 'drive',           label: 'Drive',                               icon: HardDrive, hasSubItems: false },
    { id: 'twin',            label: 'Twin',                                icon: Sparkles,  hasSubItems: true },
    { id: 'companion',       label: 'Companion',                           icon: Bot,       hasSubItems: true },
    { id: 'research-lab',    label: t.shared.sidebar_extra.research_lab,    icon: BookOpen, hasSubItems: true, devOnly: true },
  ], [t]);

  const browseMeta = allPlugins.find((p) => p.id === 'browse')!;
  const sortedPlugins = useMemo<PluginMeta[]>(
    () => allPlugins
      .filter((p) => p.id !== 'browse' && enabledPlugins.has(p.id) && (!p.devOnly || import.meta.env.DEV))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [allPlugins, enabledPlugins],
  );

  const activePluginLabel = useMemo(
    () => allPlugins.find((p) => p.id === pluginTab)?.label ?? pluginTab,
    [allPlugins, pluginTab],
  );

  const activePluginMeta = allPlugins.find((p) => p.id === pluginTab);
  const activePluginGated = activePluginMeta?.devOnly && !import.meta.env.DEV;
  const isL3 = PLUGINS_WITH_SUBITEMS.has(pluginTab) && enabledPlugins.has(pluginTab) && !activePluginGated;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {isL3 ? (
        <PluginL3
          key={`plugin-l3-${pluginTab}`}
          plugin={pluginTab}
          onBack={() => setPluginTab('browse')}
          backLabel={activePluginLabel}
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
          studioJobActive={studioJobActive}
        />
      ) : (
        <div key="plugin-l2" className="flex flex-col h-full">
          <nav className="flex-1 px-2 py-2 overflow-y-auto" role="tablist" aria-label="Plugins">
            {/* Browse — pinned at top. It's the plugin manager, not a plugin
                itself, so it sits above the alphabetical plugin list with a
                divider between them. */}
            {(() => {
              const Icon = browseMeta.icon;
              const isActive = pluginTab === 'browse';
              return (
                <button
                  key="browse"
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setPluginTab('browse')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{browseMeta.label}</span>
                </button>
              );
            })()}
            {sortedPlugins.length > 0 && (
              <div className="my-2 border-t border-primary/10" />
            )}
            <div className="space-y-1">
              {sortedPlugins.map((plugin) => {
                const Icon = plugin.icon;
                const CustomIcon = PLUGIN_ICONS[plugin.id];
                const isActive = pluginTab === plugin.id;
                const showArtistRunning = plugin.id === 'artist' && creativeSessionRunning;
                const showTwinStudioRunning = plugin.id === 'twin' && studioJobActive;
                const showTwinMissing = plugin.id === 'twin' && !studioJobActive && !activeTwin && twinProfiles.length === 0 && pluginTab === 'twin';
                const devBorder = plugin.devOnly ? 'border border-amber-400/60 ring-1 ring-amber-400/20' : 'border border-transparent';
                return (
                  <button
                    key={plugin.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setPluginTab(plugin.id)}
                    title={plugin.devOnly ? `${plugin.label} — in development (dev builds only)` : undefined}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${devBorder} ${
                      isActive
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
                    }`}
                  >
                    {CustomIcon
                      ? <CustomIcon active={isActive} className={`w-4 h-4 flex-shrink-0 ${plugin.devOnly ? 'text-amber-400' : ''}`} />
                      : <Icon className={`w-4 h-4 flex-shrink-0 ${plugin.devOnly ? 'text-amber-400' : ''}`} />}
                    <span className="flex-1 text-left truncate">{plugin.label}</span>
                    {plugin.id === 'dev-tools' && fleetWaitingCount > 0 && (
                      <span
                        data-testid="devtools-l2-waiting-badge"
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-500/25 text-violet-200 typo-caption font-bold border border-violet-500/40 animate-pulse"
                        title={fleetWaitingCount === 1
                          ? tx(t.plugins.fleet.needs_input_one, { count: fleetWaitingCount })
                          : tx(t.plugins.fleet.needs_input_other, { count: fleetWaitingCount })}
                      >
                        {fleetWaitingCount}
                      </span>
                    )}
                    {plugin.id === 'companion' && companionApprovalsCount > 0 && (
                      <span
                        data-testid="companion-l2-approvals-badge"
                        className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 typo-caption font-bold border border-amber-500/40"
                        title={companionApprovalsCount === 1
                          ? tx(t.plugins.fleet.approvals_pending_one, { count: companionApprovalsCount })
                          : tx(t.plugins.fleet.approvals_pending_other, { count: companionApprovalsCount })}
                      >
                        {companionApprovalsCount}
                      </span>
                    )}
                    {plugin.devOnly && (
                      <span
                        className="px-1.5 py-0.5 rounded-full typo-caption font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/40 uppercase tracking-wide"
                        aria-label={debtText("auto_in_development_f6146d71")}
                      >
                        Dev
                      </span>
                    )}
                    {showArtistRunning && (
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inset-0 rounded-full animate-ping bg-orange-500/40" />
                        <span className="relative w-2.5 h-2.5 rounded-full bg-orange-500 border border-orange-600/50" />
                      </span>
                    )}
                    {showTwinStudioRunning && (
                      <span className="relative flex h-2.5 w-2.5" title={t.twin.studioInProgress}>
                        <span className="absolute inset-0 rounded-full animate-ping bg-violet-500/40" />
                        <span className="relative w-2.5 h-2.5 rounded-full bg-violet-500 border border-violet-600/50" />
                      </span>
                    )}
                    {showTwinMissing && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
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
  studioJobActive: boolean;
}

function PluginL3(props: PluginL3Props) {
  const { plugin, onBack, backLabel } = props;
  const { t } = useTranslation();

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
          rightSlot: item.id === 'training' && props.studioJobActive ? (
            <span className="relative flex h-2.5 w-2.5" title={t.twin.studioInProgress}>
              <span className="absolute inset-0 rounded-full animate-ping bg-violet-500/40" />
              <span className="relative w-2.5 h-2.5 rounded-full bg-violet-500 border border-violet-600/50" />
            </span>
          ) : null,
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
  }, [plugin, props.fleetWaitingCount, props.pendingConflicts, props.studioJobActive, t.twin.studioInProgress]);

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
