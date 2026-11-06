import { Wrench, Brain, HardDrive, type LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { PluginTab } from '@/lib/types/types';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Puzzle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getBrandTokens } from '@/lib/connectors/brandTokens';
import { PLUGIN_ICONS } from './PluginIcons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { TwinGlyph } from './twin/TwinGlyph';

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
  // via `localeCompare`. In-development plugins
  // (DEV-builds-only) are hidden from Browse entirely and surfaced
  // only via the L2 sidebar with a golden border.
  // Card colours are derived per-plugin from the central brand-token registry
  // (`getBrandTokens`) rather than hardcoded here, so each plugin's icon, tint,
  // and border stay consistent with its panel and badges elsewhere in the app.
  const PLUGINS: PluginDef[] = ([
    { id: 'dev-tools', label: t.plugins.dev_tools_label, description: t.plugins.dev_tools_desc, icon: Wrench },
    { id: 'obsidian-brain', label: t.plugins.obsidian_brain_label, description: t.plugins.obsidian_brain_desc, icon: Brain },
    { id: 'drive', label: t.plugins.drive_label, description: t.plugins.drive_desc, icon: HardDrive },
    { id: 'twin', label: t.plugins.twin_label, description: t.plugins.twin_desc, icon: TwinGlyph },
  ] satisfies PluginDef[]).slice().sort((a, b) => a.label.localeCompare(b.label));
  const enabledPlugins = useSystemStore((s) => s.enabledPlugins);
  const togglePlugin = useSystemStore((s) => s.togglePlugin);

  return (
    <ContentBox data-testid="plugin-browse-page">
      <ContentHeader
        icon={<Puzzle className="w-5 h-5" />}
        iconColor="primary"
        title={t.plugins.title}
        subtitle={t.plugins.subtitle}
      />

      <ContentBody centered>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4">
          {PLUGINS.map((plugin) => {
            const Icon = plugin.icon;
            const CustomIcon = PLUGIN_ICONS[plugin.id];
            const enabled = enabledPlugins.has(plugin.id);
            const brand = getBrandTokens(plugin.id);
            return (
              <div
                key={plugin.id}
                className={`rounded-card border border-hair bg-surface-1 transition-colors ${enabled ? '' : 'text-ink-3'}`}
              >
                <div className="flex items-start gap-4 p-4">
                  <div className={`w-10 h-10 rounded-interactive border border-hair-2 bg-surface-2 flex items-center justify-center flex-shrink-0 ${enabled ? brand.icon : 'text-ink-3'}`}>
                    {CustomIcon
                      ? <CustomIcon active={enabled} className="w-5 h-5" />
                      : <Icon className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="typo-section-title">{plugin.label}</h3>
                      <AccessibleToggle
                        checked={enabled}
                        onChange={() => togglePlugin(plugin.id)}
                        label={plugin.label}
                        size="sm"
                      />
                    </div>
                    <p className="typo-body text-ink-2 mt-1">{plugin.description}</p>
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
