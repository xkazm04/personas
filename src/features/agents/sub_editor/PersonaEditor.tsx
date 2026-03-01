import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, AlertCircle, ListChecks, FileText, Link, Settings, FlaskConical, Wand2, Cloud, LogIn, X } from 'lucide-react';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader } from '@/features/shared/components/ContentLayout';
import type { EditorTab } from '@/lib/types/types';
import { PersonaPromptEditor } from '@/features/agents/sub_editor/PersonaPromptEditor';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import { PersonaSettingsTab } from '@/features/agents/sub_editor/PersonaSettingsTab';
import { PersonaUseCasesTab } from '@/features/agents/sub_editor/PersonaUseCasesTab';
import { PersonaConnectorsTab } from '@/features/agents/sub_editor/PersonaConnectorsTab';
import { DesignTab } from '@/features/agents/sub_editor/DesignTab';
import { LabTab } from '@/features/agents/sub_lab/LabTab';
import { type PersonaDraft, buildDraft, draftChanged, SETTINGS_KEYS, MODEL_KEYS } from '@/features/agents/sub_editor/PersonaDraft';
import { OLLAMA_CLOUD_BASE_URL, getOllamaPreset } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';
import { EditorDirtyProvider, useEditorDirty, useEditorDirtyState } from '@/features/agents/sub_editor/EditorDocument';
import { useDebouncedSave } from '@/hooks';

const tabDefs: Array<{ id: EditorTab; label: string; icon: typeof FileText }> = [
  { id: 'use-cases', label: 'Use Cases', icon: ListChecks },
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'lab', label: 'Lab', icon: FlaskConical },
  { id: 'connectors', label: 'Connectors', icon: Link },
  { id: 'design', label: 'Design', icon: Wand2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function PersonaEditor() {
  return (
    <EditorDirtyProvider>
      <PersonaEditorInner />
    </EditorDirtyProvider>
  );
}

function PersonaEditorInner() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const editorTab = usePersonaStore((s) => s.editorTab);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);
  const deletePersona = usePersonaStore((s) => s.deletePersona);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const showDesignNudge = usePersonaStore((s) => s.showDesignNudge);
  const setShowDesignNudge = usePersonaStore((s) => s.setShowDesignNudge);
  const showCloudNudge = usePersonaStore((s) => s.showCloudNudge);
  const setShowCloudNudge = usePersonaStore((s) => s.setShowCloudNudge);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingPersonaId, setPendingPersonaId] = useState<string | null>(null);
  const [connectorsMissing, setConnectorsMissing] = useState(0);

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

  // Clear all editor state when the active persona is deleted (selectedPersona becomes null)
  useEffect(() => {
    if (!selectedPersona) {
      setPendingPersonaId(null);
      setShowDeleteConfirm(false);
      dirtyRef.current = false;
      prevPersonaIdRef.current = undefined;
      const empty = buildDraft({ name: '', enabled: false });
      setDraft(empty);
      setBaseline(empty);
    }
  }, [selectedPersona]);

  // Patch helper -- merges partial updates into draft
  const patch = useCallback((updates: Partial<PersonaDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  // Dirty detection: key-driven comparison so new PersonaDraft fields are safe by default
  const settingsDirty = draftChanged(draft, baseline, SETTINGS_KEYS);
  const modelDirty = draftChanged(draft, baseline, MODEL_KEYS);

  // Save functions — defined before useEditorDirty so they can be registered as save callbacks
  const handleSaveSettings = async () => {
    if (!selectedPersona) return;
    await applyPersonaOp(selectedPersona.id, {
      kind: 'UpdateSettings',
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
      profile = JSON.stringify({
        model: draft.selectedModel,
        provider: 'anthropic',
      } satisfies ModelProfile);
    }

    await applyPersonaOp(selectedPersona.id, {
      kind: 'SwitchModel',
      model_profile: profile,
      max_budget_usd: draft.maxBudget === '' ? null : draft.maxBudget,
      max_turns: draft.maxTurns === '' ? null : draft.maxTurns,
    });
    setBaseline((prev) => ({ ...prev, selectedModel: draft.selectedModel, selectedProvider: draft.selectedProvider, baseUrl: draft.baseUrl, authToken: draft.authToken, customModelName: draft.customModelName, maxBudget: draft.maxBudget, maxTurns: draft.maxTurns }));
  };

  // Debounced auto-save for settings and model fields
  const { isSaving: isSavingSettings, cancel: cancelSettingsSave } = useDebouncedSave(
    handleSaveSettings,
    settingsDirty && !!selectedPersona && !pendingPersonaId,
    [draft.name, draft.description, draft.icon, draft.color, draft.maxConcurrent, draft.timeout, draft.enabled],
    800,
  );
  const { isSaving: isSavingModel, cancel: cancelModelSave } = useDebouncedSave(
    saveModelSettings,
    modelDirty && !!selectedPersona && !pendingPersonaId,
    [draft.selectedModel, draft.selectedProvider, draft.baseUrl, draft.authToken, draft.customModelName, draft.maxBudget, draft.maxTurns],
    800,
  );
  const isSaving = isSavingSettings || isSavingModel;

  // Register all dirty state + save/cancel callbacks with the unified EditorDocument.
  // This is the single source of truth for unsaved changes across all tabs.
  useEditorDirty('settings', settingsDirty, handleSaveSettings, cancelSettingsSave);
  useEditorDirty('model', modelDirty, saveModelSettings, cancelModelSave);

  // Aggregate dirty state from EditorDocument (covers ALL tabs: settings, model, prompt, notifications, use-cases)
  const { isDirty, dirtyTabs: allDirtyTabs, saveAll: saveAllTabs, cancelAll: cancelAllDebouncedSaves, clearAll: clearAllDirty } = useEditorDirtyState();

  // Keep dirtyRef in sync for the store subscription
  dirtyRef.current = isDirty;

  // Intercept persona switches when any tab is dirty.
  // Immediately cancel all debounced saves so they don't fire while the
  // Save/Discard banner is visible.
  useEffect(() => {
    const unsub = usePersonaStore.subscribe((state) => {
      const newId = state.selectedPersonaId;
      if (newId !== prevPersonaIdRef.current && dirtyRef.current) {
        // Revert the store selection back to the current persona
        usePersonaStore.setState({ selectedPersonaId: prevPersonaIdRef.current ?? null });
        cancelAllDebouncedSaves();
        setPendingPersonaId(newId);
      }
    });
    return unsub;
  }, [cancelAllDebouncedSaves]);

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
    try {
      await applyPersonaOp(selectedPersona.id, { kind: 'ToggleEnabled', enabled: nextEnabled });
      patch({ enabled: nextEnabled });
      setBaseline((prev) => ({ ...prev, enabled: nextEnabled }));
    } catch {
      // store.error already set
    }
  };

  if (!selectedPersona) {
    return (
      <ContentBox>
        <div className="flex-1 flex items-center justify-center text-muted-foreground/80">
          No persona selected
        </div>
      </ContentBox>
    );
  }

  const handleDiscardAndSwitch = () => {
    cancelAllDebouncedSaves();
    const target = pendingPersonaId;
    setPendingPersonaId(null);
    dirtyRef.current = false;
    clearAllDirty();
    if (target !== null) {
      usePersonaStore.getState().selectPersona(target);
    }
  };

  const handleSaveAndSwitch = async () => {
    // Cancel pending debounced saves to prevent them racing with the manual save
    cancelAllDebouncedSaves();
    try {
      // Unified save: saveAllTabs covers settings, model, prompt, notifications, use-cases
      await saveAllTabs();
    } catch {
      // updatePersona now re-throws — don't proceed with switch
      return;
    }

    const target = pendingPersonaId;
    setPendingPersonaId(null);
    dirtyRef.current = false;
    clearAllDirty();
    if (target !== null) {
      usePersonaStore.getState().selectPersona(target);
    }
  };

  // Collect all dirty section names for the banner (unified from EditorDocument)
  const changedSections: string[] = allDirtyTabs.map((t) => t.charAt(0).toUpperCase() + t.slice(1));

  const handleDelete = async () => {
    await deletePersona(selectedPersona.id);
    setShowDeleteConfirm(false);
  };

  const renderTabContent = () => {
    switch (editorTab) {
      case 'use-cases':
        return (
          <PersonaUseCasesTab
            draft={draft}
            patch={patch}
            modelDirty={modelDirty}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
          />
        );
      case 'prompt':
        return <PersonaPromptEditor />;
      case 'lab':
        return <LabTab />;
      case 'connectors':
        return <PersonaConnectorsTab onMissingCountChange={setConnectorsMissing} />;
      case 'design':
        return <DesignTab />;
      case 'settings':
        return (
          <PersonaSettingsTab
            draft={draft}
            patch={patch}
            isDirty={isDirty}
            changedSections={changedSections}
            connectorDefinitions={connectorDefinitions}
            showDeleteConfirm={showDeleteConfirm}
            setShowDeleteConfirm={setShowDeleteConfirm}
            isSaving={isSaving}
            onDelete={handleDelete}
          />
        );
      default:
        return null;
    }
  };

  const personaIcon = selectedPersona.icon ? (
    selectedPersona.icon.startsWith('http') ? (
      <img src={selectedPersona.icon} alt="" className="w-6 h-6 rounded" />
    ) : (
      <span className="text-2xl leading-none">{selectedPersona.icon}</span>
    )
  ) : (
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
      style={{
        backgroundColor: `${selectedPersona.color || '#6B7280'}20`,
        border: `1px solid ${selectedPersona.color || '#6B7280'}40`,
        color: selectedPersona.color || '#6B7280',
      }}
    >
      {selectedPersona.name.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={personaIcon}
        title={selectedPersona.name}
        subtitle={selectedPersona.description || undefined}
        actions={
          <div className="relative flex items-center gap-2 flex-shrink-0">
            <span className={`text-sm font-medium transition-colors ${selectedPersona.enabled ? 'text-emerald-400' : 'text-muted-foreground/80'}`}>
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
                  <p className="text-sm font-medium text-amber-400 mb-1.5 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Cannot enable persona
                  </p>
                  {readiness.reasons.map((r, i) => (
                    <p key={i} className="text-sm text-muted-foreground/80 pl-5">
                      {r}
                    </p>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
      />

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
              <span className="text-sm text-amber-400/90 flex-1">
                Unsaved changes{changedSections.length > 0 ? `: ${changedSections.join(', ')}` : ''}
              </span>
              <button
                onClick={handleSaveAndSwitch}
                className="px-3 py-1 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
              >
                Save & Switch
              </button>
              <button
                onClick={handleDiscardAndSwitch}
                className="px-3 py-1 rounded-lg text-sm font-medium bg-secondary/50 text-foreground/80 border border-primary/15 hover:bg-secondary/70 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => setPendingPersonaId(null)}
                className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/90 transition-colors"
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
            const tabDirty = allDirtyTabs.includes(tab.id)
              || (tab.id === 'use-cases' && allDirtyTabs.includes('model'));
            return (
              <button
                key={tab.id}
                onClick={() => setEditorTab(tab.id)}
                className={`relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive ? 'text-primary' : 'text-muted-foreground/90 hover:text-foreground/95'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tabDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                {tab.id === 'connectors' && connectorsMissing > 0 && (
                  <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                )}
                {tab.id === 'design' && showDesignNudge && !isActive && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                  </span>
                )}
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

      {/* Design wizard nudge */}
      <AnimatePresence>
        {showDesignNudge && editorTab !== 'design' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mx-6 my-2 bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 flex items-center gap-3">
              <Wand2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
              <span className="text-sm text-violet-300/90 flex-1">
                Customize this template with the AI Design Wizard
              </span>
              <button
                onClick={() => {
                  setEditorTab('design');
                  setShowDesignNudge(false);
                }}
                className="px-3 py-1 rounded-lg text-sm font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors"
              >
                Try Design Wizard
              </button>
              <button
                onClick={() => setShowDesignNudge(false)}
                className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/90 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cloud setup nudge */}
      <AnimatePresence>
        {showCloudNudge && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mx-6 my-2 bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 flex items-center gap-3">
              <Cloud className="w-4 h-4 text-sky-400 flex-shrink-0" />
              <span className="text-sm text-sky-300/90 flex-1">
                {isAuthenticated
                  ? 'Connect a cloud orchestrator to run personas remotely'
                  : 'Sign in to unlock cloud features and remote execution'}
              </span>
              {!isAuthenticated && (
                <button
                  onClick={() => {
                    setSidebarSection('settings');
                    setShowCloudNudge(false);
                  }}
                  className="px-3 py-1 rounded-lg text-sm font-medium bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors flex items-center gap-1.5"
                >
                  <LogIn className="w-3 h-3" />
                  Sign In
                </button>
              )}
              <button
                onClick={() => {
                  setSidebarSection('cloud');
                  setShowCloudNudge(false);
                }}
                className="px-3 py-1 rounded-lg text-sm font-medium bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors flex items-center gap-1.5"
              >
                <Cloud className="w-3 h-3" />
                Set up Cloud
              </button>
              <button
                onClick={() => setShowCloudNudge(false)}
                className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/90 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {renderTabContent()}
      </div>
    </ContentBox>
  );
}
