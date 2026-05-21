import { useState, useEffect, useCallback, useRef } from 'react';
import { preparePersonaExecution } from '@/api/agents/executions';
import { useAgentStore } from '@/stores/agentStore';
import { useEditorDirtyState, useEditorHistory } from '../libs/EditorDocument';
import { useEditorSave } from '../libs/useEditorSave';
import { type PersonaDraft, buildDraft, checkModelProfileIntegrity } from '../libs/PersonaDraft';

const emptyDraft = () => buildDraft({ name: '', enabled: false });

export function useEditorDraft() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const selectedPersonaId = selectedPersona?.id;
  const pendingPersonaId = useAgentStore((s) => s.pendingSelectPersonaId);
  const cancelPendingSwitch = useAgentStore((s) => s.cancelPendingSwitch);

  const [draft, setDraft] = useState<PersonaDraft>(() =>
    selectedPersona ? buildDraft(selectedPersona) : emptyDraft(),
  );
  const [baseline, setBaseline] = useState<PersonaDraft>(draft);
  const [dismissedWarnings, setDismissedWarnings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  const prevPersonaIdRef = useRef(selectedPersona?.id);

  const patch = useCallback((updates: Partial<PersonaDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  // Detect a corrupted persisted model_profile so we can (a) warn the user
  // and (b) suppress auto-save of model fields until they explicitly
  // re-select — otherwise the reset-to-default values would overwrite the
  // still-recoverable raw JSON on disk.
  const modelProfileIntegrity = checkModelProfileIntegrity(selectedPersona?.model_profile);
  const modelProfileCorrupt = !modelProfileIntegrity.ok;

  const { isSaving, modelDirty, saveError } = useEditorSave({
    draft,
    baseline,
    setDraft,
    setBaseline,
    pendingPersonaId,
    suppressModelSave: modelProfileCorrupt,
  });
  const { isDirty, dirtyTabs: allDirtyTabs, saveAll: saveAllTabs, cancelAll: cancelAllDebouncedSaves, clearAll: clearAllDirty } = useEditorDirtyState();
  const { undo, redo, clearHistory } = useEditorHistory();

  const preparationFingerprint = selectedPersona ? JSON.stringify({
    id: selectedPersona.id,
    systemPrompt: selectedPersona.system_prompt ?? '',
    structuredPrompt: selectedPersona.structured_prompt ?? '',
    designContext: selectedPersona.design_context ?? '',
    modelProfile: selectedPersona.model_profile ?? '',
    tools: selectedPersona.tools?.map((tool) => tool.id).sort() ?? [],
    automations: selectedPersona.automations?.map((automation) => automation.id).sort() ?? [],
  }) : '';

  useEffect(() => {
    if (!selectedPersonaId || pendingPersonaId || isSaving) return;
    const handle = window.setTimeout(() => {
      void preparePersonaExecution(selectedPersonaId).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(handle);
  }, [selectedPersonaId, pendingPersonaId, isSaving, preparationFingerprint]);

  // Reset draft when persona changes (not during a pending switch)
  useEffect(() => {
    if (selectedPersona && !pendingPersonaId) {
      const d = buildDraft(selectedPersona);
      setDraft(d);
      setBaseline(d);
      prevPersonaIdRef.current = selectedPersona.id;
      setDismissedWarnings(false);
      clearHistory();
    }
  }, [selectedPersona?.id, pendingPersonaId, clearHistory, selectedPersona]);

  // Clear draft when persona is deselected
  useEffect(() => {
    if (!selectedPersona) {
      cancelPendingSwitch();
      setShowDeleteConfirm(false);
      prevPersonaIdRef.current = undefined;
      const empty = emptyDraft();
      setDraft(empty);
      setBaseline(empty);
    }
  }, [selectedPersona, cancelPendingSwitch]);

  const baseWarnings = selectedPersona?.warnings ?? [];
  const modelProfileWarning = !modelProfileIntegrity.ok
    ? [`Model config couldn't be parsed (${modelProfileIntegrity.rawLength} bytes) — fields reset to defaults. Auto-save is paused for model fields. Pick a model to repair, or restore from a backup.`]
    : [];
  const partialLoadWarnings = !dismissedWarnings
    ? [...baseWarnings, ...modelProfileWarning]
    : [];

  return {
    draft,
    baseline,
    patch,
    setBaseline,
    isSaving,
    modelDirty,
    saveError,
    isDirty,
    allDirtyTabs,
    saveAllTabs,
    cancelAllDebouncedSaves,
    clearAllDirty,
    undo,
    redo,
    partialLoadWarnings,
    dismissWarnings: () => setDismissedWarnings(true),
    showDeleteConfirm,
    setShowDeleteConfirm,
    connectorsMissing,
    setConnectorsMissing,
  };
}
