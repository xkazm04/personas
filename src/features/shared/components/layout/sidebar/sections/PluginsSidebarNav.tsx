import { Puzzle, ScanLine, Palette, Brain, BookOpen, Wrench, HardDrive } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import type { DevToolsTab } from '@/lib/types/types';
import { devToolsItems, researchLabItems } from '../sidebarData';
import { useTranslation } from '@/i18n/useTranslation';

export function PluginsSidebarNav() {
  const { t } = useTranslation();
  const pluginTab = useSystemStore((s) => s.pluginTab);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const devToolsTab = useSystemStore((s) => s.devToolsTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const researchLabTab = useSystemStore((s) => s.researchLabTab);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
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
                    <p className="text-[10px] uppercase tracking-wider text-foreground/90 font-medium mb-0.5">{t.shared.sidebar_extra.active_project}</p>
                    <p className="typo-caption text-foreground truncate">{activeProject.name}</p>
                    {activeProject.root_path && (
                      <p className="text-[10px] text-foreground/90 truncate mt-0.5">{activeProject.root_path}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
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

        {/* Drive (absorbed Doc Signing) */}
        {enabledPlugins.has('drive') && (
          <button
            onClick={() => setPluginTab('drive')}
            aria-current={pluginTab === 'drive' ? 'page' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
              pluginTab === 'drive'
                ? 'bg-primary/10 text-foreground/90'
                : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
            }`}
          >
            <HardDrive className="w-4 h-4 flex-shrink-0" />
            Drive
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

        {/* Research Lab */}
        {enabledPlugins.has('research-lab') && (
          <div className="space-y-1">
            <button
              onClick={() => setPluginTab('research-lab')}
              aria-current={pluginTab === 'research-lab' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                pluginTab === 'research-lab'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
              }`}
            >
              <BookOpen className="w-4 h-4 flex-shrink-0" />
              Research Lab
            </button>
            {pluginTab === 'research-lab' && (
              <div className="ml-4 space-y-0.5">
                {researchLabItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setResearchLabTab(item.id as import('@/lib/types/types').ResearchLabTab)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                      researchLabTab === item.id
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
