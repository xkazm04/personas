import { useCallback, useEffect, useRef, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { createLogger } from '@/lib/log';

const logger = createLogger('useDebouncedSave');

/**
 * Debounces an async save function, firing `delay`ms after the last dep change.
 * Manages its own isSaving state and cleans up the timer on unmount.
 *
 * @param saveFn   - async function to call after the debounce delay
 * @param isDirty  - when false the timer is never started (guards are pre-computed by caller)
 * @param deps     - dependency list that resets the debounce (same semantics as useEffect deps)
 * @param delay    - debounce delay in ms (default 800)
 * @returns { isSaving, lastError, cancel } - isSaving is true while saveFn is executing;
 *          lastError holds the most recent save failure (cleared on next successful save);
 *          cancel clears any pending debounce timer (call before a manual save to prevent races)
 */
export function useDebouncedSave(
  saveFn: () => Promise<void>,
  isDirty: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: readonly any[],
  delay = 800,
): { isSaving: boolean; lastError: string | null; cancel: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always keep a ref to the latest saveFn to avoid stale closures in the timer
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const [isSaving, setIsSaving] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isDirty) {
      cancel();
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      setIsSaving(true);
      try {
        await saveFnRef.current();
        setLastError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Save failed';
        setLastError(msg);
        logger.error('auto-save failed', { error: err instanceof Error ? err.message : String(err) });
        useToastStore.getState().addToast(
          `Auto-save failed: ${msg}. Changes will retry on next edit.`,
          'error',
        );
      } finally {
        setIsSaving(false);
      }
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, cancel, delay, deps]);

  // Flush (not just cancel) a pending save on UNMOUNT. A discrete edit made in
  // the final debounce window before the editor closes — e.g. picking a persona
  // icon — was otherwise silently lost: the timer-effect's cleanup cleared the
  // timer without firing. This is a mount-once effect (empty deps) so it runs
  // ONLY on real unmount, not on every dep change. The navigation/close guard
  // calls cancel() first (nulling the timer), so this never double-saves that
  // path; it only catches an unguarded unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        // Fire-and-forget: the component is gone so isSaving/lastError can't be
        // tracked, but the persist (which reads the latest draft via refs) runs.
        void saveFnRef.current();
      }
    };
  }, []);

  return { isSaving, lastError, cancel };
}
