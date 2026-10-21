import type { KeyboardEvent } from 'react';

/**
 * Keyboard twin of a gallery row's onClick: Enter / Space on the ROW itself
 * activates it. A key pressed on a control nested in the row (compare toggle,
 * menu, connector buttons) is that control's own and must not also fire the
 * row, hence the `target === currentTarget` guard.
 */
export function onRowActivateKey(activate: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    activate();
  };
}
