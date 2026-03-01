import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox } from '@/features/shared/components/ContentLayout';
import { PersonaPromptEditor } from '@/features/agents/sub_editor/sub_prompt/PersonaPromptEditor';
import { PersonaSettingsTab } from '@/features/agents/sub_editor/sub_settings/PersonaSettingsTab';
import { PersonaUseCasesTab } from '@/features/agents/sub_editor/sub_use_cases/PersonaUseCasesTab';
import { PersonaConnectorsTab } from '@/features/agents/sub_editor/sub_connectors/PersonaConnectorsTab';
import { DesignTab } from '@/features/agents/sub_editor/sub_design/DesignTab';
import { LabTab } from '@/features/agents/sub_lab/LabTab';
import { type PersonaDraft, buildDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { EditorDirtyProvider, useEditorDirtyState } from '@/features/agents/sub_editor/EditorDocument';
import { useEditorSave } from '@/features/agents/sub_editor/useEditorSave';
import { UnsavedChangesBanner, DesignNudgeBanner, CloudNudgeBanner } from '@/features/agents/sub_editor/EditorBanners';
import { EditorTabBar } from '@/features/agents/sub_editor/EditorTabBar';
import { PersonaEditorHeader } from '@/features/agents/sub_editor/PersonaEditorHeader';

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
  const deletePersona = usePersonaStore((s) => s.deletePersona);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingPersonaId, setPendingPersonaId] = useState<string | null>(null);
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  const [draft, setDraft] = useState<PersonaDraft>(() =>
    selectedPersona ? buildDraft(selectedPersona) : buildDraft({ name: '', enabled: false }),
  );
  const [baseline, setBaseline] = useState<PersonaDraft>(draft);
  const prevPersonaIdRef = useRef(selectedPersona?.id);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (selectedPersona && !pendingPersonaId) {
      const d = buildDraft(selectedPersona);
      setDraft(d);
      setBaseline(d);
      prevPersonaIdRef.current = selectedPersona.id;
    }
  }, [selectedPersona?.id, pendingPersonaId]);

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

  const patch = useCallback((updates: Partial<PersonaDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  const { isSaving, modelDirty } = useEditorSave({ draft, baseline, setBaseline, pendingPersonaId });
  const { isDirty, dirtyTabs: allDirtyTabs, saveAll: saveAllTabs, cancelAll: cancelAllDebouncedSaves, clearAll: clearAllDirty } = useEditorDirtyState();
  dirtyRef.current = isDirty;

  useEffect(() => {
    const unsub = usePersonaStore.subscribe((state) => {
      const newId = state.selectedPersonaId;
      if (newId !== prevPersonaIdRef.current && dirtyRef.current) {
        usePersonaStore.setState({ selectedPersonaId: prevPersonaIdRef.current ?? null });
        cancelAllDebouncedSaves();
        setPendingPersonaId(newId);
      }
    });
    return unsub;
  }, [cancelAllDebouncedSaves]);

  if (!selectedPersona) {
    return (
      <ContentBox>
        <div className="flex-1 flex items-center justify-center text-muted-foreground/80">No persona selected</div>
      </ContentBox>
    );
  }

  const handleDiscardAndSwitch = () => {
    cancelAllDebouncedSaves();
    const target = pendingPersonaId;
    setPendingPersonaId(null);
    dirtyRef.current = false;
    clearAllDirty();
    if (target !== null) usePersonaStore.getState().selectPersona(target);
  };

  const handleSaveAndSwitch = async () => {
    cancelAllDebouncedSaves();
    try { await saveAllTabs(); } catch { return; }
    const target = pendingPersonaId;
    setPendingPersonaId(null);
    dirtyRef.current = false;
    clearAllDirty();
    if (target !== null) usePersonaStore.getState().selectPersona(target);
  };

  const changedSections = allDirtyTabs.map((t) => t.charAt(0).toUpperCase() + t.slice(1));

  return (
    <ContentBox>
      <PersonaEditorHeader patch={patch} setBaseline={setBaseline} />

      <UnsavedChangesBanner
        visible={!!pendingPersonaId}
        changedSections={changedSections}
        onSaveAndSwitch={handleSaveAndSwitch}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onDismiss={() => setPendingPersonaId(null)}
      />

      <EditorTabBar dirtyTabs={allDirtyTabs} connectorsMissing={connectorsMissing} />
      <DesignNudgeBanner />
      <CloudNudgeBanner />

      <div className="flex-1 overflow-y-auto p-4">
        {editorTab === 'use-cases' && <PersonaUseCasesTab draft={draft} patch={patch} modelDirty={modelDirty} credentials={credentials} connectorDefinitions={connectorDefinitions} />}
        {editorTab === 'prompt' && <PersonaPromptEditor />}
        {editorTab === 'lab' && <LabTab />}
        {editorTab === 'connectors' && <PersonaConnectorsTab onMissingCountChange={setConnectorsMissing} />}
        {editorTab === 'design' && <DesignTab />}
        {editorTab === 'settings' && (
          <PersonaSettingsTab
            draft={draft} patch={patch} isDirty={isDirty} changedSections={changedSections}
            connectorDefinitions={connectorDefinitions} showDeleteConfirm={showDeleteConfirm}
            setShowDeleteConfirm={setShowDeleteConfirm} isSaving={isSaving}
            onDelete={async () => { await deletePersona(selectedPersona.id); setShowDeleteConfirm(false); }}
          />
        )}
      </div>
    </ContentBox>
  );
}
