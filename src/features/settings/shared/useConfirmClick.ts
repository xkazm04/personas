import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseConfirmClickOptions {
  /** How long the armed state stays active before auto-reverting. Defaults to 3000ms. */
  timeoutMs?: number;
}

export interface UseConfirmClickResult {
  /** True once the first click has armed the confirm state (auto-reverts after `timeoutMs`). */
  armed: boolean;
  /**
   * Click handler for the confirm-on-second-click button. First call arms
   * (and starts the auto-revert timer); a second call within the window
   * disarms and invokes `onConfirm`.
   */
  trigger: () => void;
  /** Manually reset the armed state (and clear the pending timer) without confirming. */
  reset: () => void;
}

/**
 * Owns the "first click arms, second click commits, auto-revert after N ms"
 * pattern used by destructive/irreversible row actions (delete, disconnect,
 * reset). The auto-revert timer is ref-tracked and cleared on unmount so a
 * row that disappears mid-window (e.g. a sibling delete reloads the list)
 * never calls `setState` on an unmounted component.
 */
export function useConfirmClick(
  onConfirm: () => void,
  { timeoutMs = 3000 }: UseConfirmClickOptions = {},
): UseConfirmClickResult {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setArmed(false);
  }, [clearTimer]);

  const trigger = useCallback(() => {
    if (!armed) {
      setArmed(true);
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setArmed(false);
      }, timeoutMs);
      return;
    }
    clearTimer();
    setArmed(false);
    onConfirm();
  }, [armed, clearTimer, onConfirm, timeoutMs]);

  return { armed, trigger, reset };
}
