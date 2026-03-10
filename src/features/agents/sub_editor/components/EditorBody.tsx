import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { type PersonaDraft, buildDraft } from '../libs/PersonaDraft';
import { useEditorDirtyState, TabSaveError } from '../libs/EditorDocument';
import { tabIdsToLabels } from '../libs/editorTabConstants';
import { useEditorSave } from '../libs/useEditorSave';
import { UnsavedChangesBanner, DesignNudgeBanner, CloudNudgeBanner } from './EditorBanners';
import { OnboardingBanner } from '@/features/agents/components/onboarding/OnboardingChecklist';
import { EditorTabBar } from './EditorTabBar';
import { PersonaEditorHeader } from './PersonaEditorHeader';
import PanelSkeleton from '@/features/shared/components/layout/PanelSkeleton';
import {
  PersonaPromptEditor, PersonaSettingsTab, PersonaUseCasesTab,
  PersonaConnectorsTab, DesignTab, LabTab, PromptPerformanceCard, HealthTab,
} from './EditorLazyTabs';

export function EditorBody() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const editorTab = usePersonaStore((s) => s.editorTab);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const setLabMode = usePersonaStore((s) => s.setLabMode);
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
      try {
        await saveAllTabs();
      } catch (err) {
        const label = err instanceof TabSaveError
          ? `Failed to save ${tabIdsToLabels(err.failedTabs)}`
          : 'Failed to save changes';
        useToastStore.getState().addToast(label, 'error');
        return;
      }
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

  const handleOpenLab = useCallback(() => {
    setEditorTab('lab');
    setLabMode('versions');
  }, [setEditorTab, setLabMode]);

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
      <OnboardingBanner personaId={selectedPersona.id} />

      <div className="flex-1 overflow-y-auto p-4">
        {/* Prompt Performance Summary Card -- shown on prompt and use-cases tabs */}
        {(editorTab === 'prompt' || editorTab === 'use-cases') && (
          <Suspense fallback={null}>
            <div className="mb-4">
              <PromptPerformanceCard personaId={selectedPersona.id} onOpenLab={handleOpenLab} />
            </div>
          </Suspense>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={editorTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <Suspense fallback={<PanelSkeleton variant="tab" />}>
              {editorTab === 'use-cases' && <PersonaUseCasesTab draft={draft} patch={patch} modelDirty={modelDirty} credentials={credentials} connectorDefinitions={connectorDefinitions} />}
              {editorTab === 'prompt' && <PersonaPromptEditor />}
              {editorTab === 'lab' && <LabTab />}
              {editorTab === 'connectors' && <PersonaConnectorsTab onMissingCountChange={setConnectorsMissing} />}
              {editorTab === 'design' && <DesignTab />}
              {editorTab === 'health' && <HealthTab />}
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
