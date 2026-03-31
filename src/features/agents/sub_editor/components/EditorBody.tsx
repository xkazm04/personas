import { useEffect, useCallback, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { Bot, RefreshCw } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { UnsavedChangesBanner, CloudNudgeBanner, PartialLoadBanner } from './EditorBanners';
import { EditorTabBar } from './EditorTabBar';
import { PersonaEditorHeader } from './PersonaEditorHeader';
import {
  ActivityTab, MatrixTab,
  PersonaPromptEditor, PersonaSettingsTab, PersonaUseCasesTab,
  PersonaConnectorsTab, LabTab, ChatTab,
} from './EditorLazyTabs';
import { EditorTabContent } from './EditorTabContent';
import { useUnsavedGuard } from '@/hooks/utility/interaction/useUnsavedGuard';
import { UnsavedChangesModal } from '@/features/shared/components/overlays/UnsavedChangesModal';
import { useEditorDraft } from '../hooks/useEditorDraft';
import { usePersonaSwitchGuard } from '../hooks/usePersonaSwitchGuard';
import { useEditorKeyboard } from '../hooks/useEditorKeyboard';

export function EditorBody() {
  const {
    selectedPersona, deletePersona,
    pendingSelectPersonaId: pendingPersonaId,
    setEditorDirty, cancelPendingSwitch,
  } = useAgentStore(useShallow((s) => ({
    selectedPersona: s.selectedPersona,
    deletePersona: s.deletePersona,
    pendingSelectPersonaId: s.pendingSelectPersonaId,
    setEditorDirty: s.setEditorDirty,
    cancelPendingSwitch: s.cancelPendingSwitch,
  })));
  const editorTab = useSystemStore((s) => s.editorTab);
  const { credentials, connectorDefinitions } = useVaultStore(useShallow((s) => ({
    credentials: s.credentials,
    connectorDefinitions: s.connectorDefinitions,
  })));

  const {
    draft, baseline, patch, setBaseline,
    isSaving, modelDirty, saveError,
    isDirty, allDirtyTabs,
    saveAllTabs, cancelAllDebouncedSaves, clearAllDirty,
    undo, redo,
    partialLoadWarnings, dismissWarnings,
    showDeleteConfirm, setShowDeleteConfirm,
    connectorsMissing, setConnectorsMissing,
  } = useEditorDraft();

  const { handleDiscardAndSwitch, handleSaveAndSwitch } = usePersonaSwitchGuard({
    cancelAllDebouncedSaves,
    saveAllTabs,
    clearAllDirty,
  });

  // Global unsaved-changes guard for sidebar section navigation + window close
  const guard = useUnsavedGuard(isDirty, {
    onSave: async () => {
      cancelAllDebouncedSaves();
      await saveAllTabs();
    },
    onDiscard: () => {
      cancelAllDebouncedSaves();
      clearAllDirty();
    },
  });

  // Sync dirty state to the store so selectPersona can guard atomically
  useEffect(() => {
    setEditorDirty(isDirty);
  }, [isDirty, setEditorDirty]);

  useEditorKeyboard(undo, redo);

  const handleDelete = useCallback(async () => {
    if (!selectedPersona) return;
    await deletePersona(selectedPersona.id);
    const { buildPersonaId, resetBuildSession } = useAgentStore.getState();
    if (buildPersonaId === selectedPersona.id) {
      resetBuildSession();
    }
    setShowDeleteConfirm(false);
  }, [selectedPersona, deletePersona, setShowDeleteConfirm]);

  if (!selectedPersona) {
    return (
      <ContentBox>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 animate-fade-slide-in">
          <Bot className="w-12 h-12 text-muted-foreground/20" />
          <p className="typo-heading text-muted-foreground/80">Select an agent to get started</p>
          <p className="typo-body text-muted-foreground/50">Choose from the sidebar or create a new agent</p>
        </div>
      </ContentBox>
    );
  }

  const changedSections = allDirtyTabs.map((t) => t.charAt(0).toUpperCase() + t.slice(1));

  return (
    <ContentBox>
      <PersonaEditorHeader draft={draft} baseline={baseline} patch={patch} setBaseline={setBaseline} />

      <UnsavedChangesBanner
        visible={!!pendingPersonaId}
        changedSections={changedSections}
        onSaveAndSwitch={handleSaveAndSwitch}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onDismiss={cancelPendingSwitch}
      />

      <EditorTabBar dirtyTabs={allDirtyTabs} connectorsMissing={connectorsMissing} />
      <CloudNudgeBanner />
      <PartialLoadBanner warnings={partialLoadWarnings} onDismiss={dismissWarnings} />

      {saveError && (
        <div className="animate-fade-slide-in mx-6 my-2 rounded-xl px-3 py-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20">
          <RefreshCw className="w-3.5 h-3.5 text-red-400 animate-spin flex-shrink-0" style={{ animationDuration: '3s' }} />
          <span className="typo-body text-red-300/90">Save failed — will retry on next edit</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="animate-fade-slide-in"
            key={editorTab}
          >
            <Suspense fallback={<SuspenseFallback />}>
              {editorTab === 'activity' && <ActivityTab />}
              {editorTab === 'matrix' && (
                <EditorTabContent className="space-y-6">
                  <MatrixTab />
                  <PersonaPromptEditor />
                </EditorTabContent>
              )}
              {editorTab === 'use-cases' && (
                <EditorTabContent>
                  <PersonaUseCasesTab draft={draft} patch={patch} modelDirty={modelDirty} credentials={credentials} connectorDefinitions={connectorDefinitions} />
                </EditorTabContent>
              )}
              {editorTab === 'lab' && <LabTab />}
              {editorTab === 'connectors' && (
                <EditorTabContent>
                  <PersonaConnectorsTab onMissingCountChange={setConnectorsMissing} />
                </EditorTabContent>
              )}
              {editorTab === 'chat' && <ChatTab />}
              {editorTab === 'settings' && (
                <EditorTabContent>
                  <PersonaSettingsTab
                    draft={draft} patch={patch} isDirty={isDirty} changedSections={changedSections}
                    connectorDefinitions={connectorDefinitions} showDeleteConfirm={showDeleteConfirm}
                    setShowDeleteConfirm={setShowDeleteConfirm} isSaving={isSaving}
                    onDelete={handleDelete}
                  />
                </EditorTabContent>
              )}
            </Suspense>
          </div>
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
