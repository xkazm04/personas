import { Puzzle, Palette, Brain, BookOpen, Wrench, HardDrive, Sparkles } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import type { ArtistTab, DevToolsTab, TwinTab } from '@/lib/types/types';
import { artistItems, devToolsItems, researchLabItems, twinItems } from '../sidebarData';
import { useTranslation } from '@/i18n/useTranslation';

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
  const twinTab = useSystemStore((s) => s.twinTab);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore((s) => s.projects);
  const creativeSessionRunning = useSystemStore((s) => s.creativeSessionRunning);

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
  const activeTwin = activeTwinId ? twinProfiles.find((tw) => tw.id === activeTwinId) : null;

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
              ? 'bg-primary/10 text-primary'
              : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
          }`}
        >
          <Puzzle className="w-4 h-4 flex-shrink-0" />
          Browse
        </button>

        {/* Artist */}
        {enabledPlugins.has('artist') && (
          <div className="space-y-1">
            <button
              onClick={() => setPluginTab('artist')}
              aria-current={pluginTab === 'artist' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                pluginTab === 'artist'
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
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
            {/* Artist sub-tabs */}
            {pluginTab === 'artist' && (
              <div className="ml-4 space-y-0.5">
                {artistItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setArtistTab(item.id as ArtistTab)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                      artistTab === item.id
                        ? 'bg-primary/10 text-primary'
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

        {/* Dev Tools */}
        {enabledPlugins.has('dev-tools') && (
          <div className="space-y-1">
            <button
              onClick={() => setPluginTab('dev-tools')}
              aria-current={pluginTab === 'dev-tools' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                pluginTab === 'dev-tools'
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
              }`}
            >
              <Wrench className="w-4 h-4 flex-shrink-0" />
              {t.shared.sidebar_extra.dev_tools_label}
            </button>
            {activeProject && (
              <div className="ml-7 -mt-0.5 mb-1 flex">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium truncate max-w-full">
                  {activeProject.name}
                </span>
              </div>
            )}
            {/* Dev Tools sub-tabs */}
            {pluginTab === 'dev-tools' && (
              <div className="ml-4 space-y-0.5">
                {devToolsItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setDevToolsTab(item.id as DevToolsTab)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                      devToolsTab === item.id
                        ? 'bg-primary/10 text-primary'
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

        {/* Brain (Obsidian) */}
        {enabledPlugins.has('obsidian-brain') && (
          <button
            onClick={() => setPluginTab('obsidian-brain')}
            aria-current={pluginTab === 'obsidian-brain' ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              pluginTab === 'obsidian-brain'
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <Brain className="w-4 h-4 flex-shrink-0" />
            {t.shared.sidebar_extra.obsidian_brain}
          </button>
        )}

        {/* Drive (absorbed Doc Signing) */}
        {enabledPlugins.has('drive') && (
          <button
            onClick={() => setPluginTab('drive')}
            aria-current={pluginTab === 'drive' ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              pluginTab === 'drive'
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <HardDrive className="w-4 h-4 flex-shrink-0" />
            Drive
          </button>
        )}

        {/* Twin */}
        {enabledPlugins.has('twin') && (
          <div className="space-y-1">
            <button
              onClick={() => setPluginTab('twin')}
              aria-current={pluginTab === 'twin' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                pluginTab === 'twin'
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
              }`}
            >
              <Sparkles className="w-4 h-4 flex-shrink-0" />
              Twin
              {!activeTwin && twinProfiles.length === 0 && pluginTab === 'twin' && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden />
              )}
            </button>
            {activeTwin && (
              <div className="ml-7 -mt-0.5 mb-1 flex">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium truncate max-w-full">
                  {activeTwin.name}
                </span>
              </div>
            )}
            {pluginTab === 'twin' && (
              <div className="ml-4 space-y-0.5">
                {twinItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setTwinTab(item.id as TwinTab)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                      twinTab === item.id
                        ? 'bg-primary/10 text-primary'
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

        {/* Research Lab */}
        {enabledPlugins.has('research-lab') && (
          <div className="space-y-1">
            <button
              onClick={() => setPluginTab('research-lab')}
              aria-current={pluginTab === 'research-lab' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                pluginTab === 'research-lab'
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80'
              }`}
            >
              <BookOpen className="w-4 h-4 flex-shrink-0" />
              {t.shared.sidebar_extra.research_lab}
            </button>
            {pluginTab === 'research-lab' && (
              <div className="ml-4 space-y-0.5">
                {researchLabItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setResearchLabTab(item.id as import('@/lib/types/types').ResearchLabTab)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                      researchLabTab === item.id
                        ? 'bg-primary/10 text-primary'
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
