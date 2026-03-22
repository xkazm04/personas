import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useToastStore } from '@/stores/toastStore';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { type PersonaDraft, buildDraft } from '../libs/PersonaDraft';
import { useEditorDirtyState, useEditorHistory, TabSaveError } from '../libs/EditorDocument';
import { tabIdsToLabels } from '../libs/editorTabConstants';
import { useEditorSave } from '../libs/useEditorSave';
import { UnsavedChangesBanner, DesignNudgeBanner, CloudNudgeBanner } from './EditorBanners';
// OnboardingBanner removed — setup stepper no longer shown
import { EditorTabBar } from './EditorTabBar';
import { PersonaEditorHeader } from './PersonaEditorHeader';
import {
  ActivityTab, MatrixTab,
  PersonaPromptEditor, PersonaSettingsTab, PersonaUseCasesTab,
  PersonaConnectorsTab, DesignTab, LabTab, HealthTab, ChatTab,
} from './EditorLazyTabs';
import { useUnsavedGuard } from '@/hooks/utility/interaction/useUnsavedGuard';
import { UnsavedChangesModal } from '@/features/shared/components/overlays/UnsavedChangesModal';

export function EditorBody() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const editorTab = useSystemStore((s) => s.editorTab);
  const deletePersona = useAgentStore((s) => s.deletePersona);
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);

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

  const patch = useCallback((updates: Partial<PersonaDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  const { isSaving, modelDirty } = useEditorSave({ draft, baseline, setDraft, setBaseline, pendingPersonaId });
  const { isDirty, dirtyTabs: allDirtyTabs, saveAll: saveAllTabs, cancelAll: cancelAllDebouncedSaves, clearAll: clearAllDirty } = useEditorDirtyState();
  const { undo, redo, clearHistory } = useEditorHistory();

  // Global unsaved-changes guard for sidebar section navigation + window close
  const guard = useUnsavedGuard(isDirty, {
    onSave: async () => {
      cancelAllDebouncedSaves();
      await saveAllTabs();
    },
    onDiscard: () => {
      cancelAllDebouncedSaves();
      dirtyRef.current = false;
      clearAllDirty();
    },
  });

  useEffect(() => {
    if (selectedPersona && !pendingPersonaId) {
      const d = buildDraft(selectedPersona);
      setDraft(d);
      setBaseline(d);
      prevPersonaIdRef.current = selectedPersona.id;
      // New persona -- clear undo history so old entries don't leak across personas
      clearHistory();
    }
  }, [selectedPersona?.id, pendingPersonaId, clearHistory]);

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
  dirtyRef.current = isDirty;

  useEffect(() => {
    let lastSeenId = useAgentStore.getState().selectedPersonaId;
    const unsub = useAgentStore.subscribe((state) => {
      const newId = state.selectedPersonaId;
      if (newId === lastSeenId) return;
      if (dirtyRef.current) {
        useAgentStore.setState({ selectedPersonaId: prevPersonaIdRef.current ?? null });
        lastSeenId = prevPersonaIdRef.current ?? null;
        cancelAllDebouncedSaves();
        setPendingPersonaId(newId);
      } else {
        lastSeenId = newId;
      }
    });
    return unsub;
  }, [cancelAllDebouncedSaves]);

  // Ctrl+Z / Ctrl+Shift+Z for undo/redo across all editor tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only fire when no text input is focused (avoid hijacking undo inside textareas)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  if (!selectedPersona) {
    return (
      <ContentBox>
        <div className="flex-1 flex items-center justify-center text-muted-foreground/80">Select an agent to get started</div>
      </ContentBox>
    );
  }

  const handleDiscardAndSwitch = () => {
    cancelAllDebouncedSaves();
    const target = pendingPersonaId;
    setPendingPersonaId(null);
    dirtyRef.current = false;
    clearAllDirty();
    if (target !== null) useAgentStore.getState().selectPersona(target);
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
      if (target !== null) useAgentStore.getState().selectPersona(target);
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
            <Suspense fallback={null}>
              {editorTab === 'activity' && <ActivityTab />}
              {editorTab === 'matrix' && (
                <div className="space-y-6 max-w-[900px]">
                  <MatrixTab />
                  <PersonaPromptEditor />
                </div>
              )}
              {editorTab === 'use-cases' && <PersonaUseCasesTab draft={draft} patch={patch} modelDirty={modelDirty} credentials={credentials} connectorDefinitions={connectorDefinitions} />}
              {editorTab === 'prompt' && <PersonaPromptEditor />}
              {editorTab === 'lab' && <LabTab />}
              {editorTab === 'connectors' && <PersonaConnectorsTab onMissingCountChange={setConnectorsMissing} />}
              {editorTab === 'chat' && <ChatTab />}
              {editorTab === 'design' && <DesignTab />}
              {editorTab === 'health' && <HealthTab />}
              {editorTab === 'settings' && (
                <PersonaSettingsTab
                  draft={draft} patch={patch} isDirty={isDirty} changedSections={changedSections}
                  connectorDefinitions={connectorDefinitions} showDeleteConfirm={showDeleteConfirm}
                  setShowDeleteConfirm={setShowDeleteConfirm} isSaving={isSaving}
                  onDelete={async () => { await deletePersona(selectedPersona.id); const { buildPersonaId, resetBuildSession } = useAgentStore.getState(); if (buildPersonaId === selectedPersona.id) { resetBuildSession(); } setShowDeleteConfirm(false); }}
                />
              )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>

      <UnsavedChangesModal
        isOpen={guard.isOpen}
        onAction={guard.resolve}
        changedSections={changedSections}
        isSaving={isSaving}
      />
    </ContentBox>
  );
}
