import { useCallback, useEffect, type KeyboardEvent, type RefObject } from 'react';

const ITEM_SELECTOR = ['menuitem', 'menuitemradio', 'menuitemcheckbox']
  .map((role) => `[role="${role}"]:not([disabled])`)
  .join(',');

/**
 * The WAI-ARIA menu keyboard model for a `role="menu"` popup whose items are
 * buttons: on open, focus moves INTO the menu (the checked radio item, else the
 * first item); ArrowDown/ArrowUp move it with wrap, Home/End jump to the ends,
 * Tab closes the menu; on close, focus returns to the trigger when it would
 * otherwise be lost to `<body>`.
 *
 * Dismissal on outside press and Escape stays with `useClickOutside`. The
 * right-click `ContextMenu` owns the same model inline for its own items.
 */
export function useMenuKeyboard({
  menuRef,
  triggerRef,
  open,
  onClose,
}: {
  menuRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
    [menuRef],
  );

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRef?.current ?? null;
    const list = items();
    const checked = list.find((el) => el.getAttribute('aria-checked') === 'true');
    (checked ?? list[0])?.focus();
    return () => {
      const active = document.activeElement;
      const lost = active === null || active === document.body || (menu?.contains(active) ?? false);
      if (lost) trigger?.focus();
    };
  }, [open, items, menuRef, triggerRef]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Tab') {
        // Close and hand focus back to the trigger (the effect cleanup):
        // letting the default Tab run would start from a removed element.
        e.preventDefault();
        onClose();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const list = items();
      if (list.length === 0) return;
      e.preventDefault();
      const current = list.findIndex((el) => el === document.activeElement);
      let next: number;
      switch (e.key) {
        case 'ArrowDown':
          next = (current + 1) % list.length;
          break;
        case 'ArrowUp':
          next = current <= 0 ? list.length - 1 : current - 1;
          break;
        case 'Home':
          next = 0;
          break;
        default:
          next = list.length - 1;
      }
      list[next]?.focus();
    },
    [items, onClose],
  );

  return { onKeyDown };
}
