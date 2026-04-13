import { useCallback } from 'react';
import { BookMarked, Check, Trash2 } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
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
  const addToast = useToastStore((s) => s.addToast);
  const activePath = useSystemStore((s) => s.obsidianVaultPath);
  const setObsidianVaultPath = useSystemStore((s) => s.setObsidianVaultPath);
  const setObsidianVaultName = useSystemStore((s) => s.setObsidianVaultName);
  const setObsidianConnected = useSystemStore((s) => s.setObsidianConnected);

  const { configs, remove } = useSavedVaultConfigs();

  const selectConfig = useCallback(
    async (config: ObsidianVaultConfig) => {
      try {
        await obsidianBrainSaveConfig(config);
        setObsidianVaultPath(config.vaultPath);
        setObsidianVaultName(config.vaultName);
        setObsidianConnected(true);
        addToast(`Switched to "${config.vaultName}"`, 'success');
        onSelect?.(config);
      } catch (e) {
        addToast(`Failed to activate vault: ${e}`, 'error');
      }
    },
    [addToast, onSelect, setObsidianConnected, setObsidianVaultName, setObsidianVaultPath],
  );

  const removeConfig = useCallback(
    (e: React.MouseEvent, config: ObsidianVaultConfig) => {
      e.stopPropagation();
      remove(config.vaultPath);
      addToast(`Removed "${config.vaultName}" from saved vaults`, 'success');
    },
    [addToast, remove],
  );

  return (
    <aside className="w-64 flex-shrink-0 border-l border-primary/10 pl-4 py-2 flex flex-col">
      <div className="flex items-center gap-2 mb-3 px-1">
        <BookMarked className="w-3.5 h-3.5 text-violet-400/70" />
        <p className="typo-caption text-muted-foreground/60 uppercase tracking-wide">
          Saved Vaults
        </p>
        {configs.length > 0 && (
          <span className="ml-auto typo-caption text-muted-foreground/40">{configs.length}</span>
        )}
      </div>

      {configs.length === 0 ? (
        <p className="typo-caption text-muted-foreground/40 px-1 py-2 leading-relaxed">
          {emptyHint ?? 'Connect and save a vault to see it here.'}
        </p>
      ) : (
        <div className="space-y-1.5 overflow-y-auto">
          {configs.map((cfg) => {
            const active = cfg.vaultPath === activePath;
            return (
              <div
                key={cfg.vaultPath}
                className={`group relative rounded-xl border transition-colors ${
                  active
                    ? 'border-violet-500/30 bg-violet-500/10'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/20'
                }`}
              >
                <button
                  onClick={() => selectConfig(cfg)}
                  className="w-full text-left px-3 py-2.5 focus-ring rounded-xl"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p
                      className={`typo-heading truncate flex-1 ${
                        active ? 'text-violet-300' : 'text-foreground/80'
                      }`}
                    >
                      {cfg.vaultName}
                    </p>
                    {active && <Check className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />}
                  </div>
                  <p className="typo-caption text-muted-foreground/40 truncate mt-0.5">
                    {cfg.vaultPath}
                  </p>
                </button>
                <button
                  onClick={(e) => removeConfig(e, cfg)}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 focus-ring"
                  title={`Remove ${cfg.vaultName}`}
                  aria-label={`Remove ${cfg.vaultName}`}
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
