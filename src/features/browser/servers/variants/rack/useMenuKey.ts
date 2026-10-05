// Keyboard parity for the shared right-click menu. The menu opens from a
// React MouseEvent (`ServerVariantProps.onMenu`), so a key press re-enters
// through the SAME door: it dispatches a real `contextmenu` event at the
// item's own box, and the item's `onContextMenu` handles both. Chromium also
// fires a trusted `contextmenu` for the Menu key on its own; the window below
// swallows that second one so the menu opens once.
//
// LOCAL, not shared: Switchboard needs the same thing. The Director promotes it.

import { useCallback, useRef, type KeyboardEvent, type MouseEvent } from 'react';

/** The keys that mean "open the context menu" on every desktop OS. */
export function isMenuKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

const ECHO_WINDOW_MS = 400;

export function useMenuKey(onMenu: (e: MouseEvent) => void) {
  const keyedAt = useRef(0);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (!isMenuKey(e) || e.target !== e.currentTarget) return;
    e.preventDefault();
    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    keyedAt.current = performance.now();
    el.dispatchEvent(
      new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + Math.min(box.width / 2, 160),
        clientY: box.top + box.height / 2,
      }),
    );
  }, []);

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      const echo = e.nativeEvent.isTrusted && performance.now() - keyedAt.current < ECHO_WINDOW_MS;
      if (echo) {
        e.preventDefault();
        return;
      }
      onMenu(e);
    },
    [onMenu],
  );

  return { onKeyDown, onContextMenu };
}
