import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, AlertCircle, FileText, Play, Settings, X } from 'lucide-react';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';
import type { EditorTab } from '@/lib/types/types';
import { PersonaPromptEditor } from '@/features/agents/sub_editor/PersonaPromptEditor';
import { ExecutionList } from '@/features/agents/sub_executions/ExecutionList';
import { PersonaRunner } from '@/features/agents/sub_executions/PersonaRunner';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import { PersonaSettingsTab } from '@/features/agents/sub_editor/PersonaSettingsTab';
import { type PersonaDraft, buildDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { OLLAMA_CLOUD_BASE_URL, getOllamaPreset } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

const tabDefs: Array<{ id: EditorTab; label: string; icon: typeof FileText }> = [
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'executions', label: 'Executions', icon: Play },
  { id: 'settings', label: 'Settings', icon: Settings },
];

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

  // Patch helper -- merges partial updates into draft
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
          <PersonaSettingsTab
            draft={draft}
            patch={patch}
            isDirty={isDirty}
            settingsDirty={settingsDirty}
            modelDirty={modelDirty}
            changedSections={changedSections}
            connectorDefinitions={connectorDefinitions}
            credentials={credentials}
            selectedPersonaId={selectedPersona.id}
            showDeleteConfirm={showDeleteConfirm}
            setShowDeleteConfirm={setShowDeleteConfirm}
            onSaveAll={handleSaveAll}
            onDelete={handleDelete}
          />
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
