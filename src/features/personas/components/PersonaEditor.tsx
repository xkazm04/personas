import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Save, AlertTriangle, AlertCircle, FileText, Play, Settings, X, Cpu, DollarSign } from 'lucide-react';
import type { ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';
import type { EditorTab } from '@/lib/types/types';
import { PersonaPromptEditor } from './PersonaPromptEditor';
import { ExecutionList } from './ExecutionList';
import { PersonaRunner } from './PersonaRunner';
import { NotificationChannelSettings } from './NotificationChannelSettings';

const tabDefs: Array<{ id: EditorTab; label: string; icon: typeof FileText }> = [
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'executions', label: 'Executions', icon: Play },
  { id: 'settings', label: 'Settings', icon: Settings },
];

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
  maxBudget: number | '';
  maxTurns: number | '';
}

function buildDraft(persona: { name: string; description?: string | null; icon?: string | null; color?: string | null; max_concurrent?: number | null; timeout_ms?: number | null; enabled: boolean; model_profile?: string | null; max_budget_usd?: number | null; max_turns?: number | null }): PersonaDraft {
  let model = '';
  let provider: ModelProvider = 'anthropic';
  let baseUrl = '';
  let authToken = '';
  try {
    const mp: ModelProfile = persona.model_profile ? JSON.parse(persona.model_profile) : {};
    model = mp.model || '';
    provider = (mp.provider as ModelProvider) || 'anthropic';
    baseUrl = mp.base_url || '';
    authToken = mp.auth_token || '';
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
    selectedModel: model,
    selectedProvider: provider,
    baseUrl,
    authToken,
    maxBudget: persona.max_budget_usd ?? '',
    maxTurns: persona.max_turns ?? '',
  };
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
  }, [selectedPersona?.id, pendingPersonaId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const profile = draft.selectedModel === '' ? null : JSON.stringify({
      model: draft.selectedModel === 'custom' ? undefined : draft.selectedModel,
      provider: draft.selectedModel === 'custom' ? draft.selectedProvider : 'anthropic',
      base_url: draft.baseUrl || undefined,
      auth_token: draft.authToken || undefined,
    } satisfies ModelProfile);

    await updatePersona(selectedPersona.id, {
      model_profile: profile,
      max_budget_usd: draft.maxBudget === '' ? null : draft.maxBudget,
      max_turns: draft.maxTurns === '' ? null : draft.maxTurns,
    });
    setBaseline((prev) => ({ ...prev, selectedModel: draft.selectedModel, selectedProvider: draft.selectedProvider, baseUrl: draft.baseUrl, authToken: draft.authToken, maxBudget: draft.maxBudget, maxTurns: draft.maxTurns }));
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
                    <option value="haiku">Haiku (fast/cheap)</option>
                    <option value="sonnet">Sonnet (balanced)</option>
                    <option value="opus">Opus (quality)</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

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
                      <label className="block text-sm font-medium text-foreground/60 mb-1">Base URL</label>
                      <input
                        type="text"
                        value={draft.baseUrl}
                        onChange={(e) => patch({ baseUrl: e.target.value })}
                        placeholder="http://localhost:11434"
                        className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/60 mb-1">Auth Token</label>
                      <input
                        type="text"
                        value={draft.authToken}
                        onChange={(e) => patch({ authToken: e.target.value })}
                        placeholder={draft.selectedProvider === 'ollama' ? 'ollama' : 'Bearer token'}
                        className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                    </div>
                  </div>
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

                {/* Save button */}
                <div className="pt-1">
                  <button
                    onClick={saveModelSettings}
                    disabled={!modelDirty}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${
                      modelDirty
                        ? 'bg-gradient-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
                        : 'bg-secondary/40 text-muted-foreground/30 cursor-not-allowed'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save Model Settings
                    {modelDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </button>
                </div>
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
                  <div
                    className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${draft.enabled ? 'bg-emerald-500/80' : 'bg-muted-foreground/20'}`}
                    onClick={() => patch({ enabled: !draft.enabled })}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${draft.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </div>
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

            {/* Save + Danger */}
            <div className="flex items-center justify-between pt-2 border-t border-primary/10">
              <button
                onClick={handleSaveSettings}
                disabled={!settingsDirty}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${
                  settingsDirty
                    ? 'bg-gradient-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
                    : 'bg-secondary/40 text-muted-foreground/30 cursor-not-allowed'
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                Save Settings
                {settingsDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
              </button>

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
                    className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
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
            <button
              onClick={handleHeaderToggle}
              className={`w-11 h-6 rounded-full relative transition-all ${
                selectedPersona.enabled
                  ? 'bg-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                  : !readiness.canEnable
                    ? 'bg-muted-foreground/15 cursor-not-allowed'
                    : 'bg-muted-foreground/20 hover:bg-muted-foreground/30'
              }`}
              title={!readiness.canEnable && !selectedPersona.enabled ? readiness.reasons.join('; ') : undefined}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${selectedPersona.enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>

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
