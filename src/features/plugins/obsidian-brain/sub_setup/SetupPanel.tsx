import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Search, FolderOpen, CheckCircle2, XCircle, Save } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import {
  obsidianBrainDetectVaults,
  obsidianBrainTestConnection,
  obsidianBrainSaveConfig,
  type DetectedVault,
  type VaultConnectionResult,
  type ObsidianVaultConfig,
} from '@/api/obsidianBrain';
import SavedConfigsSidebar from '../SavedConfigsSidebar';
import { useSavedVaultConfigs } from '../useSavedVaultConfigs';

export default function SetupPanel() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const setObsidianVaultPath = useSystemStore((s) => s.setObsidianVaultPath);
  const setObsidianVaultName = useSystemStore((s) => s.setObsidianVaultName);
  const setObsidianConnected = useSystemStore((s) => s.setObsidianConnected);

  const { configs: savedConfigs, addOrUpdate: saveConfigToList } = useSavedVaultConfigs();
  const savedPaths = useMemo(
    () => new Set(savedConfigs.map((c) => c.vaultPath)),
    [savedConfigs],
  );

  const [detectedVaults, setDetectedVaults] = useState<DetectedVault[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [vaultPath, setVaultPath] = useState('');
  const [connectionResult, setConnectionResult] = useState<VaultConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync options (fresh defaults — do not hydrate from saved configs)
  const [syncMemories, setSyncMemories] = useState(true);
  const [syncPersonas, setSyncPersonas] = useState(true);
  const [syncConnectors, setSyncConnectors] = useState(false);
  const [autoSync, setAutoSync] = useState(false);

  // Folder mapping
  const [memoriesFolder, setMemoriesFolder] = useState('memories');
  const [personasFolder, setPersonasFolder] = useState('Personas');
  const [connectorsFolder, setConnectorsFolder] = useState('Connectors');

  const visibleDetectedVaults = useMemo(
    () => detectedVaults.filter((v) => !savedPaths.has(v.path)),
    [detectedVaults, savedPaths],
  );

  const detectVaults = useCallback(async () => {
    setDetecting(true);
    try {
      const vaults = await obsidianBrainDetectVaults();
      setDetectedVaults(vaults);
      const filteredCount = vaults.filter((v) => !savedPaths.has(v.path)).length;
      if (filteredCount === 0) {
        addToast(
          vaults.length === 0
            ? 'No Obsidian vaults detected. Try browsing manually.'
            : 'All detected vaults are already saved. Add a new one via Browse.',
          'success',
        );
      }
    } catch (e) {
      addToast(`Detection failed: ${e}`, 'error');
    } finally {
      setDetecting(false);
    }
  }, [addToast, savedPaths]);

  const browseFolder = useCallback(async () => {
    const selected = await open({ directory: true, title: 'Select Obsidian Vault' });
    if (selected && typeof selected === 'string') {
      setVaultPath(selected);
      setConnectionResult(null);
    }
  }, []);

  const testConnection = useCallback(async () => {
    if (!vaultPath) return;
    setTesting(true);
    try {
      const result = await obsidianBrainTestConnection(vaultPath);
      setConnectionResult(result);
      if (result.valid) {
        setObsidianConnected(true);
        setObsidianVaultName(result.vaultName);
      }
    } catch (e) {
      addToast(`Connection test failed: ${e}`, 'error');
    } finally {
      setTesting(false);
    }
  }, [vaultPath, addToast, setObsidianConnected, setObsidianVaultName]);

  const saveConfig = useCallback(async () => {
    if (!vaultPath || !connectionResult?.valid) {
      addToast('Please select and test a valid vault first', 'error');
      return;
    }
    setSaving(true);
    try {
      const config: ObsidianVaultConfig = {
        vaultPath,
        vaultName: connectionResult.vaultName,
        syncMemories,
        syncPersonas,
        syncConnectors,
        autoSync,
        folderMapping: { memoriesFolder, personasFolder, connectorsFolder },
      };
      await obsidianBrainSaveConfig(config);
      saveConfigToList(config);
      setObsidianVaultPath(vaultPath);
      setObsidianVaultName(connectionResult.vaultName);
      addToast('Obsidian Brain configuration saved', 'success');
    } catch (e) {
      addToast(`Save failed: ${e}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [vaultPath, connectionResult, syncMemories, syncPersonas, syncConnectors, autoSync, memoriesFolder, personasFolder, connectorsFolder, addToast, saveConfigToList, setObsidianVaultPath, setObsidianVaultName]);

  return (
    <div className="flex gap-4 py-2">
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
      {/* Vault Connection */}
      <SectionCard collapsible title="Vault Connection" subtitle="Connect to an Obsidian vault for bidirectional sync" storageKey="obsidian-setup-vault">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={detectVaults}
              disabled={detecting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors disabled:opacity-50 focus-ring"
            >
              {detecting ? <LoadingSpinner size="sm" /> : <Search className="w-4 h-4" />}
              {detecting ? 'Detecting...' : 'Auto-Detect Vaults'}
            </button>
            <button
              onClick={browseFolder}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/40 text-foreground/70 hover:bg-secondary/60 transition-colors focus-ring"
            >
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
          </div>

          {/* Detected vaults */}
          {visibleDetectedVaults.length > 0 && (
            <div className="space-y-1.5">
              <p className="typo-caption text-muted-foreground/50">Detected vaults:</p>
              {visibleDetectedVaults.map((v) => (
                <button
                  key={v.path}
                  onClick={() => { setVaultPath(v.path); setConnectionResult(null); }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors focus-ring ${
                    vaultPath === v.path
                      ? 'border-violet-500/30 bg-violet-500/5'
                      : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/20'
                  }`}
                >
                  <p className="typo-heading text-foreground/80">{v.name}</p>
                  <p className="typo-caption text-muted-foreground/40 truncate">{v.path}</p>
                </button>
              ))}
            </div>
          )}

          {/* Manual path input */}
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={vaultPath}
              onChange={(e) => { setVaultPath(e.target.value); setConnectionResult(null); }}
              placeholder={t.plugins.obsidian_brain.vault_path_placeholder}
              className="flex-1 px-3 py-2 rounded-xl bg-background/50 border border-primary/12 text-foreground/80 typo-body placeholder:text-muted-foreground/30 focus-ring transition-all"
            />
            <button
              onClick={testConnection}
              disabled={!vaultPath || testing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 focus-ring"
            >
              {testing ? <LoadingSpinner size="sm" /> : <CheckCircle2 className="w-4 h-4" />}
              Test
            </button>
          </div>

          {/* Connection result */}
          {connectionResult && (
            <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
              connectionResult.valid
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : 'bg-red-500/5 border-red-500/20'
            }`}>
              {connectionResult.valid ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              )}
              <div>
                {connectionResult.valid ? (
                  <>
                    <p className="typo-heading text-emerald-400">Connected to &ldquo;{connectionResult.vaultName}&rdquo;</p>
                    <p className="typo-caption text-muted-foreground/50">{connectionResult.noteCount} notes found</p>
                  </>
                ) : (
                  <p className="typo-heading text-red-400">{connectionResult.error}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Sync Options */}
      <SectionCard collapsible title="Sync Options" subtitle="Choose what data to synchronize" storageKey="obsidian-setup-sync">
        <div className="space-y-3">
          {[
            { label: 'Memories', desc: 'Persona memories with category, importance, and tags', checked: syncMemories, onChange: () => setSyncMemories(!syncMemories) },
            { label: 'Persona Profiles', desc: 'System prompts, config, and design context', checked: syncPersonas, onChange: () => setSyncPersonas(!syncPersonas) },
            { label: 'Connectors', desc: 'Connector definitions and service documentation', checked: syncConnectors, onChange: () => setSyncConnectors(!syncConnectors) },
            { label: 'Auto-Sync', desc: 'Automatically push changes when memories are created', checked: autoSync, onChange: () => setAutoSync(!autoSync) },
          ].map((opt) => (
            <div key={opt.label} className="flex items-center justify-between gap-4 px-3 py-2.5 rounded-xl hover:bg-secondary/20 transition-colors">
              <div className="min-w-0">
                <p className="typo-heading text-foreground/80">{opt.label}</p>
                <p className="typo-caption text-muted-foreground/50">{opt.desc}</p>
              </div>
              <AccessibleToggle checked={opt.checked} onChange={opt.onChange} label={opt.label} size="sm" />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Folder Mapping */}
      <SectionCard collapsible title="Folder Structure" subtitle="Customize how data is organized in your vault" storageKey="obsidian-setup-folders" defaultCollapsed>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Personas Folder', value: personasFolder, onChange: setPersonasFolder },
              { label: 'Memories Subfolder', value: memoriesFolder, onChange: setMemoriesFolder },
              { label: 'Connectors Folder', value: connectorsFolder, onChange: setConnectorsFolder },
            ].map((field) => (
              <div key={field.label} className="space-y-1.5">
                <label className="typo-caption text-muted-foreground/50">{field.label}</label>
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-background/50 border border-primary/12 text-foreground/80 typo-body focus-ring transition-all"
                />
              </div>
            ))}
          </div>
          <p className="typo-caption text-muted-foreground/30">
            Preview: <code className="text-violet-400/60">{personasFolder}/AgentName/{memoriesFolder}/fact/memory-title.md</code>
          </p>
        </div>
      </SectionCard>

      {/* Save */}
      <button
        onClick={saveConfig}
        disabled={saving || !connectionResult?.valid}
        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-40 focus-ring"
      >
        {saving ? <LoadingSpinner size="sm" /> : <Save className="w-4 h-4" />}
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
      </div>

      <SavedConfigsSidebar
        emptyHint="Save a vault configuration to see it here. You can switch between vaults anytime."
      />
    </div>
  );
}
