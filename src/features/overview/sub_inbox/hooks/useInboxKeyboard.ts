/**
 * useInboxKeyboard — Gmail/Linear-style keyboard triage.
 *
 *   J / ↓     — move cursor down
 *   K / ↑     — move cursor up
 *   Enter     — open the focused item (route to source view)
 *   A         — approve focused item (only valid for approval kind)
 *   R         — reject focused item (approval) / resolve (other kinds)
 *   S         — snooze focused item for 1h (default)
 *   X         — toggle selection on focused item
 *   Escape    — clear selection
 *
 * The listener is attached to `window` and only fires when the inbox is the
 * active overview tab (caller passes `enabled`). Suppressed when an editable
 * element has focus so global keys don't hijack typing.
 */
import { useEffect } from 'react';
import type { UnifiedInboxItem } from '@/features/simple-mode/types';
import type { InboxActions } from './useInboxActions';

interface Args {
  enabled: boolean;
  items: UnifiedInboxItem[];
  cursorIndex: number;
  setCursorIndex: (next: number) => void;
  selectedIds: Set<string>;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  actions: InboxActions;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useInboxKeyboard({
  enabled,
  items,
  cursorIndex,
  setCursorIndex,
  selectedIds,
  toggleSelected,
  clearSelection,
  actions,
}: Args) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const total = items.length;
      const focused = total > 0 && cursorIndex >= 0 && cursorIndex < total
        ? items[cursorIndex]
        : null;

      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          if (total === 0) return;
          e.preventDefault();
          setCursorIndex(Math.min(total - 1, Math.max(0, cursorIndex) + 1));
          return;
        }
        case 'k':
        case 'ArrowUp': {
          if (total === 0) return;
          e.preventDefault();
          setCursorIndex(Math.max(0, cursorIndex - 1));
          return;
        }
        case 'Enter': {
          if (!focused) return;
          e.preventDefault();
          actions.open(focused);
          return;
        }
        case 'a':
        case 'A': {
          if (!focused || focused.kind !== 'approval') return;
          e.preventDefault();
          void actions.approve(focused);
          return;
        }
        case 'r':
        case 'R': {
          if (!focused) return;
          e.preventDefault();
          if (focused.kind === 'approval') void actions.reject(focused);
          else void actions.resolve(focused);
          return;
        }
        case 's':
        case 'S': {
          if (!focused) return;
          e.preventDefault();
          actions.snooze(focused);
          return;
        }
        case 'x':
        case 'X': {
          if (!focused) return;
          e.preventDefault();
          toggleSelected(focused.id);
          return;
        }
        case 'Escape': {
          if (selectedIds.size === 0) return;
          e.preventDefault();
          clearSelection();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, items, cursorIndex, setCursorIndex, selectedIds, toggleSelected, clearSelection, actions]);
}
