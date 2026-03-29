import { useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { TabSaveError } from '../libs/EditorDocument';
import { tabIdsToLabels } from '../libs/editorTabConstants';

interface SwitchGuardDeps {
  cancelAllDebouncedSaves: () => void;
  saveAllTabs: () => Promise<void>;
  clearAllDirty: () => void;
}

export function usePersonaSwitchGuard({ cancelAllDebouncedSaves, saveAllTabs, clearAllDirty }: SwitchGuardDeps) {
  const commitPendingSwitch = useAgentStore((s) => s.commitPendingSwitch);
  const isSwitchingRef = useRef(false);

  const handleDiscardAndSwitch = () => {
    cancelAllDebouncedSaves();
    clearAllDirty();
    commitPendingSwitch();
  };

  const handleSaveAndSwitch = async () => {
    if (isSwitchingRef.current) return;
    isSwitchingRef.current = true;
    cancelAllDebouncedSaves();
    try {
      try {
        await saveAllTabs();
      } catch (err) {
        let label = 'Failed to save changes';
        if (err instanceof TabSaveError) {
          label = `Failed to save ${tabIdsToLabels(err.failedTabs)}`;
          if (err.savedTabs.length > 0) {
            label += ` (${tabIdsToLabels(err.savedTabs)} saved successfully)`;
          }
        }
        useToastStore.getState().addToast(label, 'error');
        return;
      }
      clearAllDirty();
      commitPendingSwitch();
    } finally {
      isSwitchingRef.current = false;
    }
  };

  return { handleDiscardAndSwitch, handleSaveAndSwitch };
}
