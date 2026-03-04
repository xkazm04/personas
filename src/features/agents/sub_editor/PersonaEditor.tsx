import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox } from '@/features/shared/components/ContentLayout';
import { type PersonaDraft, buildDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { EditorDirtyProvider, useEditorDirtyState } from '@/features/agents/sub_editor/EditorDocument';
import { useEditorSave } from '@/features/agents/sub_editor/useEditorSave';
import { UnsavedChangesBanner, DesignNudgeBanner, CloudNudgeBanner } from '@/features/agents/sub_editor/EditorBanners';
import { EditorTabBar } from '@/features/agents/sub_editor/EditorTabBar';
import { PersonaEditorHeader } from '@/features/agents/sub_editor/PersonaEditorHeader';

const PersonaPromptEditor = lazy(() =>
  import('@/features/agents/sub_prompt/PersonaPromptEditor').then((m) => ({ default: m.PersonaPromptEditor })),
);
const PersonaSettingsTab = lazy(() =>
  import('@/features/agents/sub_settings/PersonaSettingsTab').then((m) => ({ default: m.PersonaSettingsTab })),
);
const PersonaUseCasesTab = lazy(() =>
  import('@/features/agents/sub_use_cases/PersonaUseCasesTab').then((m) => ({ default: m.PersonaUseCasesTab })),
);
const PersonaConnectorsTab = lazy(() =>
  import('@/features/agents/sub_connectors/PersonaConnectorsTab').then((m) => ({ default: m.PersonaConnectorsTab })),
);
const DesignTab = lazy(() =>
  import('@/features/agents/sub_design/DesignTab').then((m) => ({ default: m.DesignTab })),
);
const LabTab = lazy(() =>
  import('@/features/agents/sub_lab/LabTab').then((m) => ({ default: m.LabTab })),
);

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
  const isSwitchingRef = useRef(false);

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
    if (isSwitchingRef.current) return;
    isSwitchingRef.current = true;
    cancelAllDebouncedSaves();
    try {
      try { await saveAllTabs(); } catch { return; }
      const target = pendingPersonaId;
      setPendingPersonaId(null);
      dirtyRef.current = false;
      clearAllDirty();
      if (target !== null) usePersonaStore.getState().selectPersona(target);
    } finally {
      isSwitchingRef.current = false;
    }
  };

  const changedSections = allDirtyTabs.map((t) => t.charAt(0).toUpperCase() + t.slice(1));

  return (
    <ContentBox>
      <PersonaEditorHeader draft={draft} baseline={baseline} patch={patch} setBaseline={setBaseline} />

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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={editorTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <Suspense fallback={<div className="py-10 text-sm text-muted-foreground/70">Loading tab...</div>}>
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
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
    </ContentBox>
  );
}
