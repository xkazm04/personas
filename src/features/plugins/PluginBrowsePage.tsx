import { Palette, Wrench, Brain, FlaskConical, HardDrive, Sparkles, type LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { PluginTab } from '@/lib/types/types';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Puzzle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface PluginDef {
  id: PluginTab;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  activeBg: string;
  activeBorder: string;
}

export default function PluginBrowsePage() {
  const { t } = useTranslation();

  const PLUGINS: PluginDef[] = [
    { id: 'artist', label: t.plugins.artist_label, description: t.plugins.artist_desc, icon: Palette, color: 'text-rose-400', activeBg: 'bg-rose-500/10', activeBorder: 'border-rose-500/20' },
    { id: 'dev-tools', label: t.plugins.dev_tools_label, description: t.plugins.dev_tools_desc, icon: Wrench, color: 'text-amber-400', activeBg: 'bg-amber-500/10', activeBorder: 'border-amber-500/20' },
    { id: 'obsidian-brain', label: t.plugins.obsidian_brain_label, description: t.plugins.obsidian_brain_desc, icon: Brain, color: 'text-violet-400', activeBg: 'bg-violet-500/10', activeBorder: 'border-violet-500/20' },
    { id: 'research-lab', label: 'Research Lab', description: 'Academic paper search and hypothesis tracking', icon: FlaskConical, color: 'text-emerald-400', activeBg: 'bg-emerald-500/10', activeBorder: 'border-emerald-500/20' },
    { id: 'drive', label: t.plugins.drive_label, description: t.plugins.drive_desc, icon: HardDrive, color: 'text-sky-400', activeBg: 'bg-sky-500/10', activeBorder: 'border-sky-500/20' },
    { id: 'twin', label: 'Twin', description: 'Build a digital twin — identity, voice, channels, and curated memory that personas can adopt.', icon: Sparkles, color: 'text-violet-400', activeBg: 'bg-violet-500/10', activeBorder: 'border-violet-500/20' },
  ];
  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);
  const togglePlugin = useSystemStore((s) => s.togglePlugin);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Puzzle className="w-5 h-5 text-primary/80" />}
        iconColor="primary"
        title={t.plugins.title}
        subtitle={t.plugins.subtitle}
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
                      <h3 className="typo-card-label">{plugin.label}</h3>
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
                    <p className="typo-body text-foreground mt-1">{plugin.description}</p>
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
