import { useCallback } from 'react';
import { BookMarked, Check, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import {
  obsidianBrainSaveConfig,
  type ObsidianVaultConfig,
} from '@/api/obsidianBrain';
import { useSavedVaultConfigs } from './useSavedVaultConfigs';

interface SavedConfigsSidebarProps {
  /** Called after a config is activated (e.g. to reload panel state). */
  onSelect?: (config: ObsidianVaultConfig) => void;
  emptyHint?: string;
}

export default function SavedConfigsSidebar({ onSelect, emptyHint }: SavedConfigsSidebarProps) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activePath = useSystemStore((s) => s.obsidianVaultPath);
  const setObsidianVaultPath = useSystemStore((s) => s.setObsidianVaultPath);
  const setObsidianVaultName = useSystemStore((s) => s.setObsidianVaultName);
  const setObsidianConnected = useSystemStore((s) => s.setObsidianConnected);
  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);

  const { configs, remove } = useSavedVaultConfigs();

  const selectConfig = useCallback(
    async (config: ObsidianVaultConfig) => {
      try {
        await obsidianBrainSaveConfig(config);
        setObsidianVaultPath(config.vaultPath);
        setObsidianVaultName(config.vaultName);
        setObsidianConnected(true);
        void fetchConnectorDefinitions();
        addToast(tx(t.plugins.obsidian_brain.vault_switched_to, { name: config.vaultName }), 'success');
        onSelect?.(config);
      } catch (e) {
        addToast(tx(t.plugins.obsidian_brain.vault_activate_failed, { error: String(e) }), 'error');
      }
    },
    [addToast, onSelect, setObsidianConnected, setObsidianVaultName, setObsidianVaultPath, fetchConnectorDefinitions, t, tx],
  );

  const removeConfig = useCallback(
    (e: React.MouseEvent, config: ObsidianVaultConfig) => {
      e.stopPropagation();
      remove(config.vaultPath);
      addToast(tx(t.plugins.obsidian_brain.vault_removed_from_saved, { name: config.vaultName }), 'success');
    },
    [addToast, remove, t, tx],
  );

  return (
    <aside className="w-64 flex-shrink-0 border-l border-primary/10 pl-4 py-2 flex flex-col">
      <div className="flex items-center gap-2 mb-3 px-1">
        <BookMarked className="w-3.5 h-3.5 text-violet-400/70" />
        <p className="typo-label typo-section-title">
          {t.plugins.obsidian_brain.saved_vaults}
        </p>
        {configs.length > 0 && (
          <span className="ml-auto typo-caption text-foreground/90">{configs.length}</span>
        )}
      </div>

      {configs.length === 0 ? (
        <p className="typo-caption text-foreground px-1 py-2 leading-relaxed">
          {emptyHint ?? t.plugins.obsidian_brain.saved_vaults_empty_hint}
        </p>
      ) : (
        <div className="space-y-1.5 overflow-y-auto">
          {configs.map((cfg) => {
            const active = cfg.vaultPath === activePath;
            return (
              <div
                key={cfg.vaultPath}
                className={`group relative rounded-modal border transition-colors ${
                  active
                    ? 'border-violet-500/30 bg-violet-500/10'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/20'
                }`}
              >
                <button
                  onClick={() => selectConfig(cfg)}
                  className="w-full text-left px-3 py-2.5 focus-ring rounded-modal"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p
                      className={`typo-heading truncate flex-1 ${
                        active ? 'text-violet-300' : 'typo-card-label'
                      }`}
                    >
                      {cfg.vaultName}
                    </p>
                    {active && <Check className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />}
                  </div>
                  <p className="typo-caption text-foreground/90 truncate mt-0.5">
                    {cfg.vaultPath}
                  </p>
                </button>
                <button
                  onClick={(e) => removeConfig(e, cfg)}
                  className="absolute top-1.5 right-1.5 p-1 rounded-input opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 text-foreground hover:text-red-400 focus-ring"
                  title={tx(t.plugins.obsidian_brain.remove_vault_aria, { name: cfg.vaultName })}
                  aria-label={tx(t.plugins.obsidian_brain.remove_vault_aria, { name: cfg.vaultName })}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
