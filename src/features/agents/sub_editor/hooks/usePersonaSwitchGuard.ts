import { useRef, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { TabSaveError } from '../libs/EditorDocument';
import { tabIdsToLabels } from '../libs/editorTabConstants';
import { useTranslation } from '@/i18n/useTranslation';

interface SwitchGuardDeps {
  cancelAllDebouncedSaves: () => void;
  saveAllTabs: () => Promise<void>;
  clearAllDirty: () => void;
  /** Told which tabs failed when Save & Switch could not save them all, so the
   *  editor can mark those tabs and offer Retry (a toast alone is gone in
   *  seconds and leaves no way back to the failed save). */
  onSaveFailed?: (failedTabs: string[]) => void;
}

export function usePersonaSwitchGuard({ cancelAllDebouncedSaves, saveAllTabs, clearAllDirty, onSaveFailed }: SwitchGuardDeps) {
  const { t, tx } = useTranslation();
  const commitPendingSwitch = useAgentStore((s) => s.commitPendingSwitch);
  const isSwitchingRef = useRef(false);
  // Mirror of the ref for rendering: the ref drops re-entry synchronously, the
  // state lets the banner show that the save is running.
  const [isSwitching, setIsSwitching] = useState(false);

  const handleDiscardAndSwitch = () => {
    cancelAllDebouncedSaves();
    clearAllDirty();
    commitPendingSwitch();
  };

  const handleSaveAndSwitch = async () => {
    if (isSwitchingRef.current) return;
    isSwitchingRef.current = true;
    setIsSwitching(true);
    cancelAllDebouncedSaves();
    try {
      try {
        await saveAllTabs();
      } catch (err) {
        // Same catalog the editor body and banner read (`agents.editor.tabs`),
        // so the toast names a tab the way the user sees it instead of from a
        // second English copy that could only drift.
        const catalog = t.agents.editor.tabs;
        let label: string = t.agents.editor.save_failed_generic;
        if (err instanceof TabSaveError) {
          onSaveFailed?.(err.failedTabs);
          label = tx(t.agents.editor.save_failed, { tabs: tabIdsToLabels(err.failedTabs, catalog) });
          if (err.savedTabs.length > 0) {
            label += ` (${tabIdsToLabels(err.savedTabs, catalog)}: ${t.agents.editor_ui.saved})`;
          }
        }
        useToastStore.getState().addToast(label, 'error');
        return;
      }
      clearAllDirty();
      commitPendingSwitch();
    } finally {
      isSwitchingRef.current = false;
      setIsSwitching(false);
    }
  };

  return { handleDiscardAndSwitch, handleSaveAndSwitch, isSwitching };
}
