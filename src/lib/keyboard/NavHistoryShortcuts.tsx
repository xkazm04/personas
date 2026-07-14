import { useEffect } from 'react';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Always-on, browser-style Back / Forward bindings (not gated behind the `;`
 * keyboard-nav mode):
 *   - `Alt + ←` / `Alt + →`  → step the section history back / forward
 *   - Mouse button 3 / 4     → the mouse's dedicated Back / Forward buttons
 *
 * All of these drive the one unified navigation history in `systemStore`
 * (see `uiSlice`), which the titlebar Back button and `;`-mode `←` already
 * share — so every affordance retraces the same trail, and the store skips
 * destinations whose registry gates now fail. Renders nothing; mounted once at
 * the app root alongside `WorkspaceShortcuts` / `KeyboardNavMode`.
 *
 * `Alt` (rather than plain `←`/`→` or `Ctrl`) dodges collisions: plain arrows
 * belong to focused widgets (sliders, scrubbers) and `;`-mode; `Ctrl+←/→` is
 * word-wise caret movement in text. Text fields are skipped so `Alt+←` word
 * navigation still works while typing.
 */
export default function NavHistoryShortcuts() {
  useAppKeyboard(
    (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
      if (isTypingTarget(e.target)) return false;
      e.preventDefault();
      const sys = useSystemStore.getState();
      if (e.key === 'ArrowLeft') sys.navigateBack();
      else sys.navigateForward();
      return true;
    },
    { priority: 15 },
  );

  useEffect(() => {
    // Buttons 3 (Back) and 4 (Forward) are the mouse's dedicated history keys.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      const sys = useSystemStore.getState();
      if (e.button === 3) sys.navigateBack();
      else sys.navigateForward();
    };
    // Swallow the matching press so the webview never runs a default action.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  return null;
}
