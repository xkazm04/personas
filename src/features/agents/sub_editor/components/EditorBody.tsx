import { useEffect, useCallback, Suspense, useState } from 'react';
import { TabSaveError } from '../libs/EditorDocument';
import { tabIdLabel, tabIdsToLabels } from '../libs/editorTabConstants';
import { useShallow } from 'zustand/react/shallow';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { UnsavedChangesBanner, PartialLoadBanner, SaveFailedBanner } from './EditorBanners';
import { EditorTabBar } from './EditorTabBar';
import { EditorEmptyState } from './EditorEmptyState';
import { PersonaDecisionsFooter } from './PersonaDecisionsFooter';
import { PersonaEditorHeader } from './PersonaEditorHeader';
import { PersonaChangeHistory } from './PersonaChangeHistory';
import {
  ActivityTab,
  PersonaSettingsTab,
  LabTab, DesignTab,
} from './EditorLazyTabs';
import { EditorTabContent } from './EditorTabContent';
import { SubTabSurface } from './SubTabSurface';
import { useUnsavedGuard } from '@/hooks/utility/interaction/useUnsavedGuard';
import { UnsavedChangesModal } from '@/features/shared/components/overlays/UnsavedChangesModal';
import { useEditorDraft } from '../hooks/useEditorDraft';
import { usePersonaReadiness } from '../libs/usePersonaReadiness';
import { usePersonaSwitchGuard } from '../hooks/usePersonaSwitchGuard';
import { useEditorKeyboard } from '../hooks/useEditorKeyboard';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useTranslation } from '@/i18n/useTranslation';
import { extractMessage, toastCatch } from '@/lib/silentCatch';

export function EditorBody() {
  const { t, tx } = useTranslation();
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

  const {
    draft, baseline, patch, setBaseline,
    isSaving, saveError,
    isDirty, allDirtyTabs,
    saveAllTabs, cancelAllDebouncedSaves, clearAllDirty,
    undo, redo,
    partialLoadWarnings, dismissWarnings,
    showDeleteConfirm, setShowDeleteConfirm,
  } = useEditorDraft();

  // Design-tab missing-connector badge — from the SAME readiness resolver the
  // header popover uses, so the count and the "why can't I enable" reasons
  // never drift. Memoized inside the hook, so this doesn't churn the tab bar.
  const { missingConnectorCount } = usePersonaReadiness();

  // Surface per-tab save failures so the user can see WHICH tab failed and
  // retry without having to make a dummy edit to re-trigger autosave. Written
  // by every explicit save path (Save & Switch, the leave guard, Retry); its
  // only writer used to be the Retry button inside the banner it gates, so the
  // banner and the tab's failed badge could never appear.
  const [failedTabs, setFailedTabs] = useState<string[]>([]);
  const selectedPersonaId = selectedPersona?.id;
  useEffect(() => { setFailedTabs([]); }, [selectedPersonaId]);

  const { handleDiscardAndSwitch, handleSaveAndSwitch, isSwitching } = usePersonaSwitchGuard({
    cancelAllDebouncedSaves,
    saveAllTabs,
    clearAllDirty,
    onSaveFailed: setFailedTabs,
  });
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
      try {
        await saveAllTabs();
      } catch (err) {
        if (err instanceof TabSaveError) setFailedTabs(err.failedTabs);
        throw err;
      }
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
    // Legacy / removed tabs bounce to the Design hub. Use Cases now lives as
    // a Design sub-tab; setEditorTab handles the sub-tab promotion.
    if (editorTab === 'matrix' || editorTab === 'chat' || editorTab === 'use-cases') {
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
      // deletePersona rejects with the IPC's AppError object, not an Error.
      const msg = extractMessage(err);
      toastCatch('EditorBody:deletePersona', tx(t.agents.editor_ui.delete_failed, { message: msg }))(err);
      // Keep the delete confirmation dialog open so the user can retry
    }
  }, [selectedPersona, deletePersona, setShowDeleteConfirm, t, tx]);

  if (!selectedPersona) {
    return <EditorEmptyState />;
  }

  // Passed uncast: the resolver declares the catalog's closed shape, so a
  // label missing from the locale files is a type error here rather than a
  // machine token on screen. Same catalog the switch-guard toast reads.
  const tabCatalog = t.agents.editor.tabs;
  const changedSections = allDirtyTabs.map((id) => tabIdLabel(id, tabCatalog));

  return (
    <ContentBox>
      <PersonaEditorHeader draft={draft} baseline={baseline} patch={patch} setBaseline={setBaseline} />

      <UnsavedChangesBanner
        visible={!!pendingPersonaId}
        changedSections={changedSections}
        onSaveAndSwitch={handleSaveAndSwitch}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onDismiss={cancelPendingSwitch}
        saving={isSwitching}
      />

      <EditorTabBar dirtyTabs={allDirtyTabs} connectorsMissing={missingConnectorCount} failedTabs={failedTabs} />
      <PartialLoadBanner warnings={partialLoadWarnings} onDismiss={dismissWarnings} />

      {failedTabs.length > 0 && (
        <SaveFailedBanner
          message={tx(t.agents.editor_ui.save_failed_tabs, { tabs: tabIdsToLabels(failedTabs, tabCatalog) })}
          actions={[
            <AsyncButton
              key="retry"
              variant="accent"
              tone="error"
              size="xs"
              onClick={runSaveAll}
              isLoading={isSaving}
              data-testid="editor-save-retry"
            >
              {t.agents.editor_ui.save_failed_retry_button}
            </AsyncButton>,
          ]}
        />
      )}

      {saveError && failedTabs.length === 0 && (
        <SaveFailedBanner message={t.agents.editor_ui.save_failed_retry} />
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <SubTabSurface tabId={editorTab}>
          <Suspense fallback={<SuspenseFallback />}>
            {editorTab === 'activity' && <ActivityTab />}
            {editorTab === 'lab' && <LabTab />}
            {editorTab === 'design' && (
              <DesignTab />
            )}
            {editorTab === 'settings' && (
              <EditorTabContent>
                <PersonaSettingsTab
                  draft={draft} patch={patch} isDirty={isDirty} changedSections={changedSections}
                  showDeleteConfirm={showDeleteConfirm}
                  setShowDeleteConfirm={setShowDeleteConfirm} isSaving={isSaving}
                  onDelete={handleDelete}
                />
                {selectedPersona?.id && (
                  <div className="max-w-3xl 3xl:max-w-4xl 4xl:max-w-5xl mt-4">
                    <PersonaChangeHistory personaId={selectedPersona.id} revision={selectedPersona.updated_at} />
                  </div>
                )}
              </EditorTabContent>
            )}
          </Suspense>
        </SubTabSurface>
      </div>

      {selectedPersona?.id && (
        <PersonaDecisionsFooter personaId={selectedPersona.id} />
      )}

      <UnsavedChangesModal
        isOpen={guard.isOpen}
        onAction={guard.resolve}
        changedSections={changedSections}
        saveError={guard.saveError}
        isSaving={isSaving || guard.isSaving}
      />
    </ContentBox>
  );
}
