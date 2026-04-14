import { useCallback } from 'react';
import { useSaveFeedback } from './useSaveFeedback';
import { useToastStore } from '@/stores/toastStore';

/**
 * Shared save-feedback hook for settings panels.
 * Combines the inline checkmark (via `useSaveFeedback`) with a short success
 * toast so that auto-saving panels give consistent "Saved" confirmation.
 *
 * @param toastMessage - Text shown in the toast (should come from i18n)
 * @param toastDurationMs - How long the toast stays visible (default 2 000 ms)
 */
export function useSettingsSaveToast(toastMessage: string, toastDurationMs = 2000) {
  const { visible, trigger: triggerCheck } = useSaveFeedback();

  const trigger = useCallback(() => {
    triggerCheck();
    useToastStore.getState().addToast(toastMessage, 'success', toastDurationMs);
  }, [triggerCheck, toastMessage, toastDurationMs]);

  return { visible, trigger } as const;
}
