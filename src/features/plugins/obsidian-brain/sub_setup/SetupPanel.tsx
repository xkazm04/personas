import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Search, FolderOpen, CheckCircle2, XCircle, Save, Brain, Users, Plug, RefreshCw, FlaskConical, Network, Sparkles } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import { ActivityDot } from '@/features/shared/components/display/ActivityDot';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import {
  obsidianBrainDetectVaults,
  obsidianBrainTestConnection,
  obsidianBrainSaveConfig,
  obsidianMirrorGetConfig,
  obsidianMirrorSetConfig,
  obsidianAvailable,
  obsidianMirrorBackfillExecutionKnowledge,
  type DetectedVault,
  type VaultConnectionResult,
  type ObsidianVaultConfig,
  type ObsidianMirrorConfig,
  type ObsidianAvailability,
} from '@/api/obsidianBrain';
import SavedConfigsSidebar from '../SavedConfigsSidebar';
import { useSavedVaultConfigs } from '../useSavedVaultConfigs';
import { silentCatch } from '@/lib/silentCatch';
import { DebtText } from '@/i18n/DebtText';


export default function SetupPanel() {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const setObsidianVaultPath = useSystemStore((s) => s.setObsidianVaultPath);
  const setObsidianVaultName = useSystemStore((s) => s.setObsidianVaultName);
  const setObsidianConnected = useSystemStore((s) => s.setObsidianConnected);

  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);
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

  // Knowledge mirror (opt-in, off by default; only surfaced when Obsidian is
  // available). Persisted independently of the form via obsidian_mirror_config.
  const [mirrorConfig, setMirrorConfig] = useState<ObsidianMirrorConfig | null>(null);
  const [availability, setAvailability] = useState<ObsidianAvailability | null>(null);

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

  const refreshMirrorState = useCallback(async () => {
    try {
      const [avail, cfg] = await Promise.all([obsidianAvailable(), obsidianMirrorGetConfig()]);
      setAvailability(avail);
      setMirrorConfig(cfg);
    } catch (e) {
      // Non-fatal — the mirror group just stays hidden.
      silentCatch('features/plugins/obsidian-brain/SetupPanel:refreshMirrorState')(e);
    }
  }, []);

  useEffect(() => {
    void refreshMirrorState();
  }, [refreshMirrorState]);

  const toggleMirror = useCallback(
    async (key: keyof ObsidianMirrorConfig) => {
      if (!mirrorConfig) return;
      const next = { ...mirrorConfig, [key]: !mirrorConfig[key] };
      setMirrorConfig(next); // optimistic
      try {
        await obsidianMirrorSetConfig(next);
        // Enabling the execution-knowledge mirror backfills existing rows once,
        // so the vault isn't empty until each persona happens to run again.
        if (key === 'executionKnowledge' && next.executionKnowledge) {
          const count = await obsidianMirrorBackfillExecutionKnowledge();
          addToast(tx(t.plugins.obsidian_brain.mirror_backfill_done, { count }), 'success');
        }
      } catch (e) {
        setMirrorConfig(mirrorConfig); // revert on failure
        addToast(tx(t.plugins.obsidian_brain.mirror_save_failed, { error: String(e) }), 'error');
      }
    },
    [mirrorConfig, addToast, t, tx],
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
      // Keep the test result purely local. The "Connected" success card below
      // reads `connectionResult.valid` directly. Flipping global obsidianConnected
      // / obsidianVaultName here used to leak: switching tabs after a successful
      // test (without Save) made every consumer believe the vault was active.
      setConnectionResult(result);
    } catch (e) {
      addToast(`Connection test failed: ${e}`, 'error');
    } finally {
      setTesting(false);
    }
  }, [vaultPath, addToast]);

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
      setObsidianConnected(true);
      // Re-fetch gated connectors so obsidian_memory becomes visible elsewhere
      void fetchConnectorDefinitions();
      // A freshly-configured vault flips Obsidian availability → surface the mirror group.
      void refreshMirrorState();
      addToast('Obsidian Brain configuration saved', 'success');
    } catch (e) {
      addToast(`Save failed: ${e}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [vaultPath, connectionResult, syncMemories, syncPersonas, syncConnectors, autoSync, memoriesFolder, personasFolder, connectorsFolder, addToast, saveConfigToList, setObsidianVaultPath, setObsidianVaultName, setObsidianConnected, fetchConnectorDefinitions, refreshMirrorState]);

  return (
    <div className="flex gap-4 py-2">
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
      {/* Vault Connection */}
      <SectionCard collapsible title={t.plugins.obsidian_brain.vault_connection} subtitle={t.plugins.obsidian_brain.vault_connection_subtitle} storageKey="obsidian-setup-vault" titleClassName="text-primary">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={detectVaults}
              disabled={detecting}
              className="flex items-center gap-2 px-4 py-2 rounded-card bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors disabled:opacity-50 focus-ring"
            >
              {detecting ? <LoadingSpinner size="sm" /> : <Search className="w-4 h-4" />}
              {detecting ? t.plugins.obsidian_brain.detecting : t.plugins.obsidian_brain.auto_detect}
            </button>
            <button
              onClick={browseFolder}
              className="flex items-center gap-2 px-4 py-2 rounded-card bg-secondary/40 text-foreground hover:bg-secondary/60 transition-colors focus-ring"
            >
              <FolderOpen className="w-4 h-4" />
              {t.plugins.obsidian_brain.browse_button}
            </button>
          </div>

          {/* Detected vaults */}
          {visibleDetectedVaults.length > 0 && (
            <div className="space-y-1.5">
              <p className="typo-label text-foreground/90">{t.plugins.obsidian_brain.detected_vaults}</p>
              {visibleDetectedVaults.map((v) => (
                <button
                  key={v.path}
                  onClick={() => { setVaultPath(v.path); setConnectionResult(null); }}
                  className={`w-full text-left px-3 py-2.5 rounded-modal border transition-colors focus-ring ${
                    vaultPath === v.path
                      ? 'border-violet-500/30 bg-violet-500/5'
                      : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/20'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ActivityDot tone={vaultPath === v.path ? 'active' : 'off'} />
                    <div className="min-w-0">
                      <p className="typo-heading typo-card-label truncate">{v.name}</p>
                      <p className="typo-caption text-foreground/60 truncate">{v.path}</p>
                    </div>
                  </div>
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
              className="flex-1 px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all"
            />
            <button
              onClick={testConnection}
              disabled={!vaultPath || testing}
              className="flex items-center gap-2 px-4 py-2 rounded-card bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 focus-ring"
            >
              {testing ? <LoadingSpinner size="sm" /> : <CheckCircle2 className="w-4 h-4" />}
              {t.plugins.obsidian_brain.test}
            </button>
          </div>

          {/* Connection result */}
          {connectionResult && (
            <div className={`flex items-start gap-3 px-4 py-3 rounded-modal border ${
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
                    <p className="typo-heading text-emerald-400">{tx(t.plugins.obsidian_brain.connected_to_vault, { name: `“${connectionResult.vaultName}”` })}</p>
                    <p className="typo-caption text-foreground/60">{tx(t.plugins.obsidian_brain.notes_found_count, { count: connectionResult.noteCount })}</p>
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
      <SectionCard collapsible title={t.plugins.obsidian_brain.sync_options} subtitle={t.plugins.obsidian_brain.sync_options_subtitle} storageKey="obsidian-setup-sync" titleClassName="text-primary">
        <div className="space-y-3">
          {[
            { icon: <Brain className="w-4 h-4 text-violet-400" />, label: t.plugins.obsidian_brain.memories, desc: t.plugins.obsidian_brain.memories_desc, checked: syncMemories, onChange: () => setSyncMemories(!syncMemories) },
            { icon: <Users className="w-4 h-4 text-violet-400" />, label: t.plugins.obsidian_brain.persona_profiles, desc: t.plugins.obsidian_brain.persona_profiles_desc, checked: syncPersonas, onChange: () => setSyncPersonas(!syncPersonas) },
            { icon: <Plug className="w-4 h-4 text-violet-400" />, label: t.plugins.obsidian_brain.connectors, desc: t.plugins.obsidian_brain.connectors_desc, checked: syncConnectors, onChange: () => setSyncConnectors(!syncConnectors) },
            { icon: <RefreshCw className="w-4 h-4 text-violet-400" />, label: t.plugins.obsidian_brain.auto_sync, desc: t.plugins.obsidian_brain.auto_sync_desc, checked: autoSync, onChange: () => setAutoSync(!autoSync) },
          ].map((opt) => (
            <SettingRow
              key={opt.label}
              variant="card"
              toggleSize="sm"
              icon={opt.icon}
              label={opt.label}
              description={opt.desc}
              checked={opt.checked}
              onChange={opt.onChange}
            />
          ))}

          {/* Knowledge mirror — opt-in, only when Obsidian is available. Saves
              immediately (independent of the Save Configuration button). */}
          {availability?.available && mirrorConfig && (
            <div className="pt-3 mt-1 border-t border-primary/10 space-y-3">
              <p className="typo-label text-foreground/90">{t.plugins.obsidian_brain.knowledge_mirror}</p>
              {[
                { key: 'researchLab' as const, icon: <FlaskConical className="w-4 h-4 text-violet-400" />, label: t.plugins.obsidian_brain.mirror_research_lab, desc: t.plugins.obsidian_brain.mirror_research_lab_desc },
                { key: 'executionKnowledge' as const, icon: <Network className="w-4 h-4 text-violet-400" />, label: t.plugins.obsidian_brain.mirror_execution_knowledge, desc: t.plugins.obsidian_brain.mirror_execution_knowledge_desc },
                { key: 'athena' as const, icon: <Sparkles className="w-4 h-4 text-violet-400" />, label: t.plugins.obsidian_brain.mirror_athena, desc: t.plugins.obsidian_brain.mirror_athena_desc },
              ].map((m) => (
                <SettingRow
                  key={m.key}
                  variant="card"
                  toggleSize="sm"
                  icon={m.icon}
                  label={m.label}
                  description={m.desc}
                  checked={!!mirrorConfig[m.key]}
                  onChange={() => toggleMirror(m.key)}
                />
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Folder Mapping */}
      <SectionCard collapsible title={t.plugins.obsidian_brain.folder_structure} subtitle={t.plugins.obsidian_brain.folder_structure_subtitle} storageKey="obsidian-setup-folders" defaultCollapsed titleClassName="text-primary">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: t.plugins.obsidian_brain.personas_folder, value: personasFolder, onChange: setPersonasFolder },
              { label: t.plugins.obsidian_brain.memories_subfolder, value: memoriesFolder, onChange: setMemoriesFolder },
              { label: t.plugins.obsidian_brain.connectors_folder, value: connectorsFolder, onChange: setConnectorsFolder },
            ].map((field) => (
              <div key={field.label} className="space-y-1.5">
                <label className="typo-label text-foreground/90">{field.label}</label>
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body focus-ring transition-all"
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5 typo-caption text-foreground/60">
            <p><DebtText k="auto_preview_4bf30626" /></p>
            <code className="block text-violet-400/60">{personasFolder}<DebtText k="auto_agentname_941ccfe3" />{memoriesFolder}<DebtText k="auto_fact_memory_title_md_d0042e52" /></code>
            {syncConnectors && (
              <code className="block text-violet-400/60">{`${connectorsFolder}/`}</code>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Save */}
      <button
        onClick={saveConfig}
        disabled={saving || !connectionResult?.valid}
        className="flex items-center gap-2 px-6 py-2.5 rounded-modal bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-40 focus-ring"
      >
        {saving ? <LoadingSpinner size="sm" /> : <Save className="w-4 h-4" />}
        {saving ? t.plugins.obsidian_brain.saving : t.plugins.obsidian_brain.save_configuration}
      </button>
      </div>

      <SavedConfigsSidebar
        emptyHint={t.plugins.obsidian_brain.saved_vaults_empty_hint_setup}
      />
    </div>
  );
}
