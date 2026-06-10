import { Wrench, Brain, HardDrive, Sparkles, Bot, type LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { PluginTab } from '@/lib/types/types';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Puzzle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getBrandTokens } from '@/lib/connectors/brandTokens';
import { PLUGIN_ICONS } from './PluginIcons';

interface PluginDef {
  id: PluginTab;
  label: string;
  description: string;
  icon: LucideIcon;
}

export default function PluginBrowsePage() {
  const { t } = useTranslation();

  // Sorted alphabetically by the user's translated label so the Browse grid
  // matches the alphabetical L2 sidebar list. Sort respects locale ordering
  // via `localeCompare`. Artist + Research Lab are in-development plugins
  // (DEV-builds-only); they're hidden from Browse entirely and surfaced
  // only via the L2 sidebar with a golden border.
  // Card colours are derived per-plugin from the central brand-token registry
  // (`getBrandTokens`) rather than hardcoded here, so each plugin's icon, tint,
  // and border stay consistent with its panel and badges elsewhere in the app.
  const PLUGINS: PluginDef[] = ([
    { id: 'dev-tools', label: t.plugins.dev_tools_label, description: t.plugins.dev_tools_desc, icon: Wrench },
    { id: 'obsidian-brain', label: t.plugins.obsidian_brain_label, description: t.plugins.obsidian_brain_desc, icon: Brain },
    { id: 'drive', label: t.plugins.drive_label, description: t.plugins.drive_desc, icon: HardDrive },
    { id: 'twin', label: t.plugins.twin_label, description: t.plugins.twin_desc, icon: Sparkles },
    { id: 'companion', label: t.plugins.companion_label, description: t.plugins.companion_desc, icon: Bot },
  ] satisfies PluginDef[]).slice().sort((a, b) => a.label.localeCompare(b.label));
  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);
  const togglePlugin = useSystemStore((s) => s.togglePlugin);

  return (
    <ContentBox data-testid="plugin-browse-page">
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
            const CustomIcon = PLUGIN_ICONS[plugin.id];
            const enabled = enabledPlugins.has(plugin.id);
            const brand = getBrandTokens(plugin.id);
            return (
              <div
                key={plugin.id}
                className={`rounded-modal border transition-all ${
                  enabled
                    ? `${brand.badgeBorder} ${brand.badgeBg}`
                    : 'border-primary/10 bg-card/40 opacity-60'
                }`}
              >
                <div className="flex items-start gap-4 p-5">
                  <div className={`w-10 h-10 rounded-modal ${brand.badgeBg} ${brand.badgeBorder} border flex items-center justify-center flex-shrink-0 ${brand.icon}`}>
                    {CustomIcon
                      ? <CustomIcon active={enabled} className="w-5 h-5" />
                      : <Icon className={`w-5 h-5 ${brand.icon}`} />}
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
                          className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-secondary shadow transition-transform ${
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
