import { Palette, Wrench, FileSignature, Brain, ScanLine, type LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { PluginTab } from '@/lib/types/types';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Puzzle } from 'lucide-react';

interface PluginDef {
  id: PluginTab;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  activeBg: string;
  activeBorder: string;
}

const PLUGINS: PluginDef[] = [
  {
    id: 'artist',
    label: 'Artist',
    description: 'Generate 3D models with Blender, create images with Leonardo AI, and manage creative assets.',
    icon: Palette,
    color: 'text-rose-400',
    activeBg: 'bg-rose-500/10',
    activeBorder: 'border-rose-500/20',
  },
  {
    id: 'dev-tools',
    label: 'Dev Tools',
    description: 'Project management, context mapping, idea scanning, triage, and task runner utilities.',
    icon: Wrench,
    color: 'text-amber-400',
    activeBg: 'bg-amber-500/10',
    activeBorder: 'border-amber-500/20',
  },
  {
    id: 'doc-signing',
    label: 'Doc Signing',
    description: 'Sign and verify documents with digital signatures directly from your workspace.',
    icon: FileSignature,
    color: 'text-blue-400',
    activeBg: 'bg-blue-500/10',
    activeBorder: 'border-blue-500/20',
  },
  {
    id: 'obsidian-brain',
    label: 'Obsidian Brain',
    description: 'Connect your Obsidian vault for knowledge retrieval, note browsing, and sync.',
    icon: Brain,
    color: 'text-violet-400',
    activeBg: 'bg-violet-500/10',
    activeBorder: 'border-violet-500/20',
  },
  {
    id: 'ocr',
    label: 'OCR',
    description: 'Extract text from images and PDFs using Gemini Vision or Claude multimodal.',
    icon: ScanLine,
    color: 'text-cyan-400',
    activeBg: 'bg-cyan-500/10',
    activeBorder: 'border-cyan-500/20',
  },
];

export default function PluginBrowsePage() {
  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);
  const togglePlugin = useSystemStore((s) => s.togglePlugin);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Puzzle className="w-5 h-5 text-primary/80" />}
        iconColor="primary"
        title="Plugins"
        subtitle="Extend your workspace with plugins. Toggle to show or hide from the sidebar."
      />

      <ContentBody centered>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-6">
          {PLUGINS.map((plugin) => {
            const Icon = plugin.icon;
            const enabled = enabledPlugins.has(plugin.id);
            return (
              <div
                key={plugin.id}
                className={`rounded-xl border transition-all ${
                  enabled
                    ? `${plugin.activeBorder} ${plugin.activeBg}`
                    : 'border-primary/10 bg-card/40 opacity-60'
                }`}
              >
                <div className="flex items-start gap-4 p-5">
                  <div className={`w-10 h-10 rounded-xl ${plugin.activeBg} ${plugin.activeBorder} border flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-5 h-5 ${plugin.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="typo-heading text-foreground">{plugin.label}</h3>
                      <button
                        onClick={() => togglePlugin(plugin.id)}
                        role="switch"
                        aria-checked={enabled}
                        className={`relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0 ${
                          enabled ? 'bg-emerald-500/80' : 'bg-secondary/60'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-[18px]' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                    <p className="typo-body text-muted-foreground mt-1">{plugin.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
