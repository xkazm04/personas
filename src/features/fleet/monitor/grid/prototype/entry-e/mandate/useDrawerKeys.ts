// The mandate drawer's keyboard, one rung above the drawer's own Escape /
// M / L (`MANDATE_DRAWER_PRIORITY`): ↑/↓ (and j/k) move the selection of the
// list on screen, Enter opens it, and each view adds its own letters (the
// mandate page: S, V, N). Plain keys only; a key typed into a field is the
// field's.

import { useCallback } from 'react';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/features/decision-center/deck/keys';

/** The drawer's own rung (Escape, M, L): an overlay over the board. */
export const MANDATE_DRAWER_PRIORITY = OVERLAY_DISMISS_PRIORITY;

export function useDrawerListKeys(opts: {
  count: number;
  selected: number;
  onSelect: (i: number) => void;
  onEnter?: () => void;
  /** Lower-case letter -> action. */
  letters?: Record<string, () => void>;
  enabled?: boolean;
}): void {
  const { count, selected, onSelect, onEnter, letters, enabled = true } = opts;
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return false;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'j') {
      if (count > 0) onSelect(Math.min(count - 1, selected + 1));
    } else if (k === 'ArrowUp' || k === 'k') {
      if (count > 0) onSelect(Math.max(0, selected - 1));
    } else if (k === 'Enter' && onEnter) {
      onEnter();
    } else {
      const act = letters?.[k.toLowerCase()];
      if (!act || e.shiftKey) return false;
      act();
    }
    e.preventDefault();
    return true;
  }, [count, selected, onSelect, onEnter, letters]);
  useAppKeyboard(onKey, { enabled, priority: MANDATE_DRAWER_PRIORITY + 1 });
}
