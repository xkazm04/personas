import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Save, AlertTriangle, AlertCircle, FileText, Play, Settings, X, Cpu, DollarSign, ExternalLink } from 'lucide-react';
import type { ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';
import type { EditorTab } from '@/lib/types/types';
import { getAppSetting, setAppSetting } from '@/api/tauriApi';
import { PersonaPromptEditor } from '@/features/agents/sub_editor/PersonaPromptEditor';
import { ExecutionList } from '@/features/agents/sub_executions/ExecutionList';
import { PersonaRunner } from '@/features/agents/sub_executions/PersonaRunner';
import { NotificationChannelSettings } from '@/features/agents/sub_editor/NotificationChannelSettings';
import { AccessibleToggle } from '@/lib/utils/AccessibleToggle';

const tabDefs: Array<{ id: EditorTab; label: string; icon: typeof FileText }> = [
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'executions', label: 'Executions', icon: Play },
  { id: 'settings', label: 'Settings', icon: Settings },
];

// ── Ollama Cloud model presets ──────────────────────────────────────────

const OLLAMA_CLOUD_BASE_URL = 'https://api.ollama.com';
const OLLAMA_API_KEY_SETTING = 'ollama_api_key';

interface OllamaCloudPreset {
  /** Value used in the <select> dropdown */
  value: string;
  /** User-facing label */
  label: string;
  /** Model ID sent to the Ollama API */
  modelId: string;
}

const OLLAMA_CLOUD_PRESETS: OllamaCloudPreset[] = [
  { value: 'ollama:qwen3-coder', label: 'Qwen3 Coder (free, Ollama Cloud)', modelId: 'qwen3-coder-next' },
  { value: 'ollama:glm-5', label: 'GLM-5 (free, Ollama Cloud)', modelId: 'glm-5' },
  { value: 'ollama:kimi-k2.5', label: 'Kimi K2.5 (free, Ollama Cloud)', modelId: 'kimi-k2.5' },
];

/** Reverse-map a stored ModelProfile back to a dropdown value. */
function profileToDropdownValue(mp: ModelProfile): string {
  // Check if it matches an Ollama Cloud preset
  if (mp.provider === 'ollama' && mp.base_url === OLLAMA_CLOUD_BASE_URL && mp.model) {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.modelId === mp.model);
    if (preset) return preset.value;
  }
  // Standard Anthropic models
  if (!mp.provider || mp.provider === 'anthropic') {
    if (mp.model === 'haiku') return 'haiku';
    if (mp.model === 'sonnet') return 'sonnet';
    if (mp.model === 'opus') return 'opus';
    if (!mp.model) return '';
  }
  return 'custom';
}

/** Check if a dropdown value is an Ollama Cloud preset. */
function isOllamaCloudValue(value: string): boolean {
  return value.startsWith('ollama:');
}

/** Get the preset for a dropdown value, or undefined. */
function getOllamaPreset(value: string): OllamaCloudPreset | undefined {
  return OLLAMA_CLOUD_PRESETS.find((p) => p.value === value);
}

// ── Draft type for all editable persona fields ─────────────────────────

interface PersonaDraft {
  name: string;
  description: string;
  icon: string;
  color: string;
  maxConcurrent: number;
  timeout: number;
  enabled: boolean;
  selectedModel: string;
  selectedProvider: ModelProvider;
  baseUrl: string;
  authToken: string;
  customModelName: string;
  maxBudget: number | '';
  maxTurns: number | '';
}

function buildDraft(persona: { name: string; description?: string | null; icon?: string | null; color?: string | null; max_concurrent?: number | null; timeout_ms?: number | null; enabled: boolean; model_profile?: string | null; max_budget_usd?: number | null; max_turns?: number | null }): PersonaDraft {
  let selectedModel = '';
  let provider: ModelProvider = 'anthropic';
  let baseUrl = '';
  let authToken = '';
  let customModelName = '';
  try {
    const mp: ModelProfile = persona.model_profile ? JSON.parse(persona.model_profile) : {};
    selectedModel = profileToDropdownValue(mp);
    provider = (mp.provider as ModelProvider) || 'anthropic';
    baseUrl = mp.base_url || '';
    authToken = mp.auth_token || '';
    if (selectedModel === 'custom' && mp.model) {
      customModelName = mp.model;
    }
  } catch {
    // ignore
  }
  return {
    name: persona.name,
    description: persona.description || '',
    icon: persona.icon || '',
    color: persona.color || '#8b5cf6',
    maxConcurrent: persona.max_concurrent || 1,
    timeout: persona.timeout_ms || 300000,
    enabled: persona.enabled,
    selectedModel,
    selectedProvider: provider,
    baseUrl,
    authToken,
    customModelName,
    maxBudget: persona.max_budget_usd ?? '',
    maxTurns: persona.max_turns ?? '',
  };
}

// ── Global Ollama API Key field ─────────────────────────────────────────

function OllamaApiKeyField() {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAppSetting(OLLAMA_API_KEY_SETTING).then((val) => {
      if (val) setApiKey(val);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    if (apiKey.trim()) {
      await setAppSetting(OLLAMA_API_KEY_SETTING, apiKey.trim());
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!loaded) return null;

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground/60 mb-1">
        Ollama API Key
        <span className="text-muted-foreground/40 font-normal ml-1">(global, shared across all personas)</span>
      </label>
      <div className="flex gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
          placeholder="Paste your key from ollama.com/settings"
          className="flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || saved}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            saved
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : apiKey.trim()
                ? 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30'
                : 'bg-secondary/40 text-muted-foreground/30 border border-primary/10 cursor-not-allowed'
          }`}
        >
          {saved ? 'Saved' : 'Save Key'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground/40">
        Sign up free at{' '}
        <a
          href="https://ollama.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary/60 hover:text-primary inline-flex items-center gap-0.5"
        >
          ollama.com <ExternalLink className="w-2.5 h-2.5" />
        </a>
        {' '}and copy your API key from Settings.
      </p>
    </div>
  );
}

// ── Global LiteLLM Proxy Config field ────────────────────────────────────

function LiteLLMConfigField() {
  const [baseUrl, setBaseUrl] = useState('');
  const [masterKey, setMasterKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getAppSetting('litellm_base_url'),
      getAppSetting('litellm_master_key'),
    ]).then(([url, key]) => {
      if (url) setBaseUrl(url);
      if (key) setMasterKey(key);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    if (baseUrl.trim()) await setAppSetting('litellm_base_url', baseUrl.trim());
    if (masterKey.trim()) await setAppSetting('litellm_master_key', masterKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!loaded) return null;

  return (
    <div className="space-y-1.5 bg-sky-500/5 border border-sky-500/15 rounded-lg p-3">
      <label className="block text-sm font-medium text-foreground/60 mb-1">
        LiteLLM Proxy Settings
        <span className="text-muted-foreground/40 font-normal ml-1">(global, shared across all agents)</span>
      </label>
      <div className="space-y-2">
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => { setBaseUrl(e.target.value); setSaved(false); }}
          placeholder="Proxy Base URL (http://localhost:4000)"
          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <input
          type="password"
          value={masterKey}
          onChange={(e) => { setMasterKey(e.target.value); setSaved(false); }}
          placeholder="Master Key (sk-...)"
          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={(!baseUrl.trim() && !masterKey.trim()) || saved}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : (baseUrl.trim() || masterKey.trim())
                  ? 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30'
                  : 'bg-secondary/40 text-muted-foreground/30 border border-primary/10 cursor-not-allowed'
            }`}
          >
            {saved ? 'Saved' : 'Save Global Config'}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground/40">
        These global settings are used as defaults for all agents using the LiteLLM provider. Per-agent overrides above take precedence.
      </p>
    </div>
  );
}

export default function PersonaEditor() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const editorTab = usePersonaStore((s) => s.editorTab);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const updatePersona = usePersonaStore((s) => s.updatePersona);
  const deletePersona = usePersonaStore((s) => s.deletePersona);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingPersonaId, setPendingPersonaId] = useState<string | null>(null);

  // Single draft object replaces 11 useState variables
  const [draft, setDraft] = useState<PersonaDraft>(() =>
    selectedPersona ? buildDraft(selectedPersona) : buildDraft({ name: '', enabled: false }),
  );

  // Baseline snapshot to detect dirty state
  const [baseline, setBaseline] = useState<PersonaDraft>(draft);

  // Track previous persona ID to detect switches
  const prevPersonaIdRef = useRef(selectedPersona?.id);
  const dirtyRef = useRef(false);

  // Reset draft when persona changes (only if no pending confirmation)
  useEffect(() => {
    if (selectedPersona && !pendingPersonaId) {
      const d = buildDraft(selectedPersona);
      setDraft(d);
      setBaseline(d);
      prevPersonaIdRef.current = selectedPersona.id;
    }
  }, [selectedPersona?.id, pendingPersonaId]);

  // Patch helper — merges partial updates into draft
  const patch = useCallback((updates: Partial<PersonaDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  // Dirty detection by comparing draft vs baseline
  const settingsDirty = draft.name !== baseline.name
    || draft.description !== baseline.description
    || draft.icon !== baseline.icon
    || draft.color !== baseline.color
    || draft.maxConcurrent !== baseline.maxConcurrent
    || draft.timeout !== baseline.timeout
    || draft.enabled !== baseline.enabled;

  const modelDirty = draft.selectedModel !== baseline.selectedModel
    || draft.selectedProvider !== baseline.selectedProvider
    || draft.baseUrl !== baseline.baseUrl
    || draft.authToken !== baseline.authToken
    || draft.customModelName !== baseline.customModelName
    || draft.maxBudget !== baseline.maxBudget
    || draft.maxTurns !== baseline.maxTurns;

  const isDirty = settingsDirty || modelDirty;

  // Keep dirtyRef in sync for the store subscription
  dirtyRef.current = isDirty;

  // Intercept persona switches when dirty
  useEffect(() => {
    const unsub = usePersonaStore.subscribe((state) => {
      const newId = state.selectedPersonaId;
      if (newId !== prevPersonaIdRef.current && dirtyRef.current) {
        // Revert the store selection back to the current persona
        usePersonaStore.setState({ selectedPersonaId: prevPersonaIdRef.current ?? null });
        setPendingPersonaId(newId);
      }
    });
    return unsub;
  }, []);

  // Compute readiness: persona can only be enabled if it has triggers/subscriptions and all tool credentials
  const readiness = useMemo(() => {
    if (!selectedPersona) return { canEnable: false, reasons: [] as string[] };
    const reasons: string[] = [];
    const triggers = selectedPersona.triggers || [];
    const subscriptions = selectedPersona.subscriptions || [];
    const hasActivation = triggers.length > 0 || subscriptions.length > 0;
    if (!hasActivation) {
      reasons.push('No triggers or event subscriptions configured');
    }
    const tools = selectedPersona.tools || [];
    const credTypes = new Set(credentials.map((c) => c.service_type));
    const missingCreds = tools
      .filter((t) => t.requires_credential_type && !credTypes.has(t.requires_credential_type))
      .map((t) => t.requires_credential_type!);
    const uniqueMissing = [...new Set(missingCreds)];
    if (uniqueMissing.length > 0) {
      reasons.push(`Missing credentials: ${uniqueMissing.join(', ')}`);
    }
    return { canEnable: reasons.length === 0, reasons };
  }, [selectedPersona, credentials]);

  const [showReadinessTooltip, setShowReadinessTooltip] = useState(false);

  const handleHeaderToggle = async () => {
    if (!selectedPersona) return;
    const nextEnabled = !selectedPersona.enabled;
    // Block enabling if not ready
    if (nextEnabled && !readiness.canEnable) {
      setShowReadinessTooltip(true);
      setTimeout(() => setShowReadinessTooltip(false), 3000);
      return;
    }
    await updatePersona(selectedPersona.id, { enabled: nextEnabled });
  };

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/40">
        No persona selected
      </div>
    );
  }

  const handleSaveSettings = async () => {
    await updatePersona(selectedPersona.id, {
      name: draft.name,
      description: draft.description || null,
      icon: draft.icon || null,
      color: draft.color || null,
      max_concurrent: draft.maxConcurrent,
      timeout_ms: draft.timeout,
      enabled: draft.enabled,
    });
    setBaseline((prev) => ({ ...prev, name: draft.name, description: draft.description, icon: draft.icon, color: draft.color, maxConcurrent: draft.maxConcurrent, timeout: draft.timeout, enabled: draft.enabled }));
  };

  const saveModelSettings = async () => {
    if (!selectedPersona) return;

    let profile: string | null = null;
    const ollamaPreset = getOllamaPreset(draft.selectedModel);

    if (ollamaPreset) {
      // Ollama Cloud preset — store model ID, provider, and cloud base URL.
      // Auth token is resolved from global setting at execution time.
      profile = JSON.stringify({
        model: ollamaPreset.modelId,
        provider: 'ollama',
        base_url: OLLAMA_CLOUD_BASE_URL,
      } satisfies ModelProfile);
    } else if (draft.selectedModel === 'custom') {
      profile = JSON.stringify({
        model: draft.customModelName || undefined,
        provider: draft.selectedProvider,
        base_url: draft.baseUrl || undefined,
        auth_token: draft.authToken || undefined,
      } satisfies ModelProfile);
    } else if (draft.selectedModel !== '') {
      // Standard Anthropic model shorthand (haiku/sonnet/opus)
      profile = JSON.stringify({
        model: draft.selectedModel,
        provider: 'anthropic',
      } satisfies ModelProfile);
    }

    await updatePersona(selectedPersona.id, {
      model_profile: profile,
      max_budget_usd: draft.maxBudget === '' ? null : draft.maxBudget,
      max_turns: draft.maxTurns === '' ? null : draft.maxTurns,
    });
    setBaseline((prev) => ({ ...prev, selectedModel: draft.selectedModel, selectedProvider: draft.selectedProvider, baseUrl: draft.baseUrl, authToken: draft.authToken, customModelName: draft.customModelName, maxBudget: draft.maxBudget, maxTurns: draft.maxTurns }));
  };

  const handleDiscardAndSwitch = () => {
    const target = pendingPersonaId;
    setPendingPersonaId(null);
    dirtyRef.current = false;
    if (target !== null) {
      usePersonaStore.getState().selectPersona(target);
    }
  };

  const handleSaveAndSwitch = async () => {
    if (settingsDirty) await handleSaveSettings();
    if (modelDirty) await saveModelSettings();
    const target = pendingPersonaId;
    setPendingPersonaId(null);
    dirtyRef.current = false;
    if (target !== null) {
      usePersonaStore.getState().selectPersona(target);
    }
  };

  const handleSaveAll = async () => {
    if (settingsDirty) await handleSaveSettings();
    if (modelDirty) await saveModelSettings();
  };

  const changedSections: string[] = [];
  if (settingsDirty) changedSections.push('Settings');
  if (modelDirty) changedSections.push('Model');

  const handleDelete = async () => {
    await deletePersona(selectedPersona.id);
    setShowDeleteConfirm(false);
  };

  const renderTabContent = () => {
    switch (editorTab) {
      case 'prompt':
        return <PersonaPromptEditor />;
      case 'executions':
        return (
          <div className="space-y-6">
            <PersonaRunner />
            <ExecutionList />
          </div>
        );
      case 'settings':
        return (
          <div className="max-w-2xl space-y-4">
            {/* Identity */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
                Identity
              </h4>
              <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-foreground/60 mb-1">Name</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/60 mb-1">Description</label>
                  <textarea
                    value={draft.description}
                    onChange={(e) => patch({ description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/60 mb-2">Icon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {connectorDefinitions
                      .filter((c) => c.icon_url)
                      .map((c) => {
                        const isSelected = draft.icon === c.icon_url;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => patch({ icon: c.icon_url! })}
                            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-all ${
                              isSelected
                                ? 'border-primary ring-2 ring-primary/30 scale-110 bg-primary/10'
                                : 'border-primary/15 bg-background/50 hover:bg-secondary/60 hover:border-primary/30'
                            }`}
                            title={c.label}
                          >
                            <img src={c.icon_url!} alt={c.label} className="w-4.5 h-4.5" />
                          </button>
                        );
                      })}
                    {['\u{1F916}', '\u{1F9E0}', '\u{26A1}', '\u{1F527}', '\u{1F4E7}', '\u{1F4CA}', '\u{1F6E1}\u{FE0F}', '\u{1F50D}'].map((emoji) => {
                      const isSelected = draft.icon === emoji;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => patch({ icon: emoji })}
                          className={`w-9 h-9 rounded-lg border flex items-center justify-center text-base transition-all ${
                            isSelected
                              ? 'border-primary ring-2 ring-primary/30 scale-110 bg-primary/10'
                              : 'border-primary/15 bg-background/50 hover:bg-secondary/60 hover:border-primary/30'
                          }`}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                    {draft.icon && (
                      <button
                        type="button"
                        onClick={() => patch({ icon: '' })}
                        className="w-9 h-9 rounded-lg border border-dashed border-primary/20 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-primary/30 transition-all"
                        title="Clear icon"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/60 mb-1">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={draft.color}
                      onChange={(e) => patch({ color: e.target.value })}
                      className="w-8 h-8 rounded-lg cursor-pointer border border-primary/15 bg-transparent"
                    />
                    <span className="text-sm font-mono text-muted-foreground/40">{draft.color}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Model & Provider */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
                <Cpu className="w-3.5 h-3.5" />
                Model &amp; Provider
              </h4>
              <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-foreground/60 mb-1">Model</label>
                  <select
                    value={draft.selectedModel}
                    onChange={(e) => patch({ selectedModel: e.target.value })}
                    className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                  >
                    <option value="">Default (Opus)</option>
                    <optgroup label="Anthropic">
                      <option value="haiku">Haiku (fast/cheap)</option>
                      <option value="sonnet">Sonnet (balanced)</option>
                      <option value="opus">Opus (quality)</option>
                    </optgroup>
                    <optgroup label="Ollama Cloud (free)">
                      {OLLAMA_CLOUD_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </optgroup>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {/* Ollama Cloud API key — shown when an Ollama Cloud model is selected */}
                {isOllamaCloudValue(draft.selectedModel) && (
                  <OllamaApiKeyField />
                )}

                {draft.selectedModel === 'custom' && (
                  <div>
                    <label className="block text-sm font-medium text-foreground/60 mb-1">Provider</label>
                    <select
                      value={draft.selectedProvider}
                      onChange={(e) => patch({ selectedProvider: e.target.value as ModelProvider })}
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="ollama">Ollama (local)</option>
                      <option value="litellm">LiteLLM (proxy)</option>
                      <option value="custom">Custom URL</option>
                    </select>
                  </div>
                )}

                {draft.selectedModel === 'custom' && draft.selectedProvider !== 'anthropic' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground/60 mb-1">Model Name</label>
                      <input
                        type="text"
                        value={draft.customModelName}
                        onChange={(e) => patch({ customModelName: e.target.value })}
                        placeholder={
                          draft.selectedProvider === 'litellm'
                            ? 'e.g. anthropic/claude-sonnet-4-20250514'
                            : draft.selectedProvider === 'ollama'
                              ? 'e.g. llama3.1:8b'
                              : 'Model identifier'
                        }
                        className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/60 mb-1">Base URL</label>
                      <input
                        type="text"
                        value={draft.baseUrl}
                        onChange={(e) => patch({ baseUrl: e.target.value })}
                        placeholder={
                          draft.selectedProvider === 'litellm'
                            ? 'http://localhost:4000'
                            : 'http://localhost:11434'
                        }
                        className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/60 mb-1">Auth Token</label>
                      <input
                        type="text"
                        value={draft.authToken}
                        onChange={(e) => patch({ authToken: e.target.value })}
                        placeholder={
                          draft.selectedProvider === 'litellm'
                            ? 'LiteLLM master key (sk-...)'
                            : draft.selectedProvider === 'ollama'
                              ? 'ollama'
                              : 'Bearer token'
                        }
                        className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                    </div>
                  </div>
                )}

                {/* LiteLLM global config — shown when LiteLLM provider is selected */}
                {draft.selectedModel === 'custom' && draft.selectedProvider === 'litellm' && (
                  <LiteLLMConfigField />
                )}

                {/* Budget Controls */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-foreground/60 mb-1">
                      <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> Max Budget (USD)</span>
                    </label>
                    <input
                      type="number"
                      value={draft.maxBudget}
                      onChange={(e) => patch({ maxBudget: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      placeholder="No limit"
                      min={0}
                      step={0.01}
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-foreground/60 mb-1">Max Turns</label>
                    <input
                      type="number"
                      value={draft.maxTurns}
                      onChange={(e) => patch({ maxTurns: e.target.value === '' ? '' : parseInt(e.target.value, 10) })}
                      placeholder="No limit"
                      min={1}
                      step={1}
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    />
                  </div>
                </div>

                {/* Model dirty indicator */}
                {modelDirty && (
                  <div className="pt-1">
                    <span className="flex items-center gap-1.5 text-xs text-amber-400/70">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      Unsaved changes
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Execution */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
                Execution
              </h4>
              <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-foreground/60 mb-1">Max Concurrent</label>
                    <input
                      type="number"
                      value={draft.maxConcurrent}
                      onChange={(e) => patch({ maxConcurrent: parseInt(e.target.value, 10) || 1 })}
                      min={1}
                      max={10}
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-foreground/60 mb-1">Timeout (sec)</label>
                    <input
                      type="number"
                      value={Math.round(draft.timeout / 1000)}
                      onChange={(e) => patch({ timeout: (parseInt(e.target.value, 10) || 300) * 1000 })}
                      min={10}
                      step={10}
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-sm font-medium text-foreground/60">Persona Enabled</span>
                  <AccessibleToggle
                    checked={draft.enabled}
                    onChange={() => patch({ enabled: !draft.enabled })}
                    label="Persona Enabled"
                    size="md"
                  />
                </div>
              </div>
            </div>

            {/* Notification Channels */}
            {selectedPersona && (
              <div className="space-y-3">
                <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
                  <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
                  Notifications
                </h4>
                <NotificationChannelSettings
                  personaId={selectedPersona.id}
                  credentials={credentials}
                  connectorDefinitions={connectorDefinitions}
                />
              </div>
            )}

            {/* Unified Save + Danger */}
            <div className="flex items-center justify-between pt-2 border-t border-primary/10">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveAll}
                  disabled={!isDirty}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${
                    isDirty
                      ? 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
                      : 'bg-secondary/40 text-muted-foreground/30 cursor-not-allowed'
                  }`}
                >
                  <Save className="w-3.5 h-3.5" />
                  Save All
                  {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                </button>
                {isDirty && (
                  <span className="text-[11px] text-muted-foreground/40">
                    {changedSections.join(' + ')} changed
                  </span>
                )}
              </div>

              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-amber-400/70 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Irreversible
                  </span>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-foreground rounded-lg text-sm font-medium transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 bg-secondary/50 text-foreground/60 rounded-lg text-sm transition-colors hover:bg-secondary/70"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-primary/10 bg-secondary/40 backdrop-blur-md px-6 py-3">
        <div className="flex items-center gap-3">
          {selectedPersona.icon ? (
            selectedPersona.icon.startsWith('http') ? (
              <img src={selectedPersona.icon} alt="" className="w-6 h-6" />
            ) : (
              <span className="text-2xl">{selectedPersona.icon}</span>
            )
          ) : null}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground">{selectedPersona.name}</h1>
            {selectedPersona.description && (
              <p className="text-xs text-muted-foreground/50 mt-0.5 truncate">{selectedPersona.description}</p>
            )}
          </div>

          {/* Enable/disable toggle */}
          <div className="relative flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs font-medium transition-colors ${selectedPersona.enabled ? 'text-emerald-400' : 'text-muted-foreground/40'}`}>
              {selectedPersona.enabled ? 'Active' : 'Off'}
            </span>
            <AccessibleToggle
              checked={selectedPersona.enabled}
              onChange={handleHeaderToggle}
              label={`${selectedPersona.enabled ? 'Disable' : 'Enable'} ${selectedPersona.name}`}
              disabled={!selectedPersona.enabled && !readiness.canEnable}
              size="lg"
              className={selectedPersona.enabled ? 'shadow-[0_0_12px_rgba(16,185,129,0.25)]' : ''}
            />

            {/* Readiness tooltip */}
            <AnimatePresence>
              {showReadinessTooltip && readiness.reasons.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-64 bg-background border border-amber-500/30 rounded-lg shadow-xl p-2.5 z-50"
                >
                  <p className="text-xs font-medium text-amber-400 mb-1.5 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Cannot enable persona
                  </p>
                  {readiness.reasons.map((r, i) => (
                    <p key={i} className="text-xs text-muted-foreground/60 pl-5">
                      {r}
                    </p>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Unsaved changes banner */}
      <AnimatePresence>
        {pendingPersonaId && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mx-6 my-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-400/90 flex-1">You have unsaved changes</span>
              <button
                onClick={handleSaveAndSwitch}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
              >
                Save & Switch
              </button>
              <button
                onClick={handleDiscardAndSwitch}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-secondary/50 text-foreground/60 border border-primary/15 hover:bg-secondary/70 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => setPendingPersonaId(null)}
                className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="border-b border-primary/10 bg-primary/5">
        <div className="flex overflow-x-auto px-6 gap-1">
          {tabDefs.map((tab) => {
            const Icon = tab.icon;
            const isActive = editorTab === tab.id;
            const tabDirty = tab.id === 'settings' && isDirty;
            return (
              <button
                key={tab.id}
                onClick={() => setEditorTab(tab.id)}
                className={`relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive ? 'text-primary' : 'text-muted-foreground/50 hover:text-foreground/70'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tabDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                {isActive && (
                  <motion.div
                    layoutId="personaEditorTab"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {renderTabContent()}
      </div>
    </div>
  );
}
