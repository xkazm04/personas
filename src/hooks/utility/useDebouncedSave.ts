import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Debounces an async save function, firing `delay`ms after the last dep change.
 * Manages its own isSaving state and cleans up the timer on unmount.
 *
 * @param saveFn   - async function to call after the debounce delay
 * @param isDirty  - when false the timer is never started (guards are pre-computed by caller)
 * @param deps     - dependency list that resets the debounce (same semantics as useEffect deps)
 * @param delay    - debounce delay in ms (default 800)
 * @returns { isSaving, cancel } - isSaving is true while saveFn is executing;
 *          cancel clears any pending debounce timer (call before a manual save to prevent races)
 */
export function useDebouncedSave(
  saveFn: () => Promise<void>,
  isDirty: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: readonly any[],
  delay = 800,
): { isSaving: boolean; cancel: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always keep a ref to the latest saveFn to avoid stale closures in the timer
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const [isSaving, setIsSaving] = useState(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      setIsSaving(true);
      await saveFnRef.current();
      setIsSaving(false);
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, deps);

  return { isSaving, cancel };
}
