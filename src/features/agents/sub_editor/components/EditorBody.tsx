import { useEffect, useCallback, Suspense, useState } from 'react';
import { TabSaveError } from '../libs/EditorDocument';
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
  ActivityTab,
  PersonaSettingsTab, PersonaUseCasesTab,
  LabTab, DesignTab,
} from './EditorLazyTabs';
import { EditorTabContent } from './EditorTabContent';
import { SubTabSurface } from './SubTabSurface';
import { useUnsavedGuard } from '@/hooks/utility/interaction/useUnsavedGuard';
import { UnsavedChangesModal } from '@/features/shared/components/overlays/UnsavedChangesModal';
import { useEditorDraft } from '../hooks/useEditorDraft';
import { usePersonaSwitchGuard } from '../hooks/usePersonaSwitchGuard';
import { useEditorKeyboard } from '../hooks/useEditorKeyboard';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

export function EditorBody() {
  const { t } = useTranslation();
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
  const { credentials } = useVaultStore(useShallow((s) => ({
    credentials: s.credentials,
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

  // Surface per-tab save failures so the user can see WHICH tab failed and
  // retry without having to make a dummy edit to re-trigger autosave.
  const [failedTabs, setFailedTabs] = useState<string[]>([]);
  const runSaveAll = useCallback(async () => {
    try {
      await saveAllTabs();
      setFailedTabs([]);
    } catch (err) {
      if (err instanceof TabSaveError) {
        setFailedTabs(err.failedTabs);
      } else {
        throw err;
      }
    }
  }, [saveAllTabs]);

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

  // Redirect away from tabs hidden by the current tier
  const { isStarter } = useTier();
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  useEffect(() => {
    // The matrix and chat tabs were removed; bounce everyone (legacy persisted
    // state) to use-cases. Companion chat now replaces the in-editor chat.
    if (editorTab === 'matrix' || editorTab === 'chat') {
      setEditorTab('use-cases');
      return;
    }
    // Starter tier hides activity / lab; redirect those too.
    if (isStarter && (editorTab === 'activity' || editorTab === 'lab')) {
      setEditorTab('use-cases');
    }
  }, [isStarter, editorTab, setEditorTab]);

  const handleDelete = useCallback(async () => {
    if (!selectedPersona) return;
    try {
      await deletePersona(selectedPersona.id);
      const { buildPersonaId, resetBuildSession } = useAgentStore.getState();
      if (buildPersonaId === selectedPersona.id) {
        resetBuildSession();
      }
      setShowDeleteConfirm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toastCatch('EditorBody:deletePersona', t.agents.editor_ui.delete_failed.replace('{message}', msg))(err);
      // Keep the delete confirmation dialog open so the user can retry
    }
  }, [selectedPersona, deletePersona, setShowDeleteConfirm, t]);

  if (!selectedPersona) {
    return (
      <ContentBox>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 animate-fade-slide-in">
          <Bot className="w-12 h-12 text-foreground" />
          <p className="typo-heading text-foreground">{t.agents.editor_ui.select_agent}</p>
          <p className="typo-body text-foreground">{t.agents.editor_ui.choose_from_sidebar}</p>
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

      <EditorTabBar dirtyTabs={allDirtyTabs} connectorsMissing={connectorsMissing} failedTabs={failedTabs} />
      <CloudNudgeBanner />
      <PartialLoadBanner warnings={partialLoadWarnings} onDismiss={dismissWarnings} />

      {failedTabs.length > 0 && (
        <div className="animate-fade-slide-in mx-6 my-2 rounded-modal px-3 py-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20">
          <RefreshCw className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <span className="typo-body text-red-300/90 flex-1">
            {t.agents.editor_ui.save_failed_tabs.replace('{tabs}', failedTabs.join(', '))}
          </span>
          <button
            type="button"
            onClick={() => void runSaveAll()}
            disabled={isSaving}
            className="px-2 py-1 typo-body rounded-card border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
          >
            {t.agents.editor_ui.save_failed_retry_button}
          </button>
        </div>
      )}

      {saveError && failedTabs.length === 0 && (
        <div className="animate-fade-slide-in mx-6 my-2 rounded-modal px-3 py-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20">
          <RefreshCw className="w-3.5 h-3.5 text-red-400 animate-spin flex-shrink-0" style={{ animationDuration: '3s' }} />
          <span className="typo-body text-red-300/90">{t.agents.editor_ui.save_failed_retry}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <SubTabSurface tabId={editorTab}>
          <Suspense fallback={<SuspenseFallback />}>
            {editorTab === 'activity' && <ActivityTab />}
            {editorTab === 'use-cases' && (
              <EditorTabContent>
                <PersonaUseCasesTab draft={draft} patch={patch} modelDirty={modelDirty} credentials={credentials} />
              </EditorTabContent>
            )}
            {editorTab === 'lab' && <LabTab />}
            {editorTab === 'design' && <DesignTab onConnectorsMissingChange={setConnectorsMissing} />}
            {editorTab === 'settings' && (
              <EditorTabContent>
                <PersonaSettingsTab
                  draft={draft} patch={patch} isDirty={isDirty} changedSections={changedSections}
                  showDeleteConfirm={showDeleteConfirm}
                  setShowDeleteConfirm={setShowDeleteConfirm} isSaving={isSaving}
                  onDelete={handleDelete}
                />
              </EditorTabContent>
            )}
          </Suspense>
        </SubTabSurface>
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
