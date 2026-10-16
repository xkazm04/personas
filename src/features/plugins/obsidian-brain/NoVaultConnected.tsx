import { Settings } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

/**
 * The "no vault connected" prerequisite state every Obsidian Brain tab shows
 * until a vault is wired. One component so the five tabs read identically;
 * the CTA always routes to the Setup tab.
 *
 * @catalog Obsidian Brain: prerequisite-not-met empty state with a Setup CTA
 */
export function NoVaultConnected({ cloud = false }: { cloud?: boolean }) {
  const { t } = useTranslation();
  const ob = t.plugins.obsidian_brain;
  const setObsidianBrainTab = useSystemStore((s) => s.setObsidianBrainTab);
  return (
    <div className="flex-1 flex items-center justify-center py-20">
      <EmptyState
        art="folder"
        size="md"
        title={ob.no_vault_connected}
        subtitle={cloud ? ob.no_vault_cloud_hint : ob.no_vault_hint}
        action={{ label: ob.tab_setup, onClick: () => setObsidianBrainTab('setup'), icon: Settings }}
      />
    </div>
  );
}
