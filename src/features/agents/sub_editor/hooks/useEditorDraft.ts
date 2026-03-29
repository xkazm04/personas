import { useState, useEffect, useCallback, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useEditorDirtyState, useEditorHistory } from '../libs/EditorDocument';
import { useEditorSave } from '../libs/useEditorSave';
import { type PersonaDraft, buildDraft } from '../libs/PersonaDraft';

const emptyDraft = () => buildDraft({ name: '', enabled: false });

export function useEditorDraft() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
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

  const { isSaving, modelDirty, saveError } = useEditorSave({ draft, baseline, setDraft, setBaseline, pendingPersonaId });
  const { isDirty, dirtyTabs: allDirtyTabs, saveAll: saveAllTabs, cancelAll: cancelAllDebouncedSaves, clearAll: clearAllDirty } = useEditorDirtyState();
  const { undo, redo, clearHistory } = useEditorHistory();

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
  }, [selectedPersona?.id, pendingPersonaId, clearHistory]);

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

  const partialLoadWarnings = (!dismissedWarnings && selectedPersona?.warnings?.length)
    ? selectedPersona.warnings
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
