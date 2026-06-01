import { useState } from 'react';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Keyboard navigation mode, entered by pressing `;` (semicolon).
 *
 * Mounted once near the app root (alongside `WorkspaceShortcuts`) so the toggle
 * works from anywhere. While the mode is active:
 *   - `←` (ArrowLeft) → go back one page, mirroring the titlebar Back button
 *     (`useSystemStore().navigateBack` — closes an open header overlay, runs a
 *     registered back-interceptor, or pops the sidebar nav history).
 *   - `;` again, or `Esc`, exits the mode.
 *
 * A subtle non-linear edge glow (see `.kbd-nav-glow` in globals.css) frames the
 * viewport while active so the changed control mode is visible at a glance.
 *
 * Registry entries live in `shortcutRegistry.ts` so the `?` cheat-sheet stays in
 * sync. The toggle never fires while the user is typing into a field.
 */

/** Don't hijack `;` / arrows while the user is typing into a field. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export default function KeyboardNavMode() {
  const [active, setActive] = useState(false);

  useAppKeyboard(
    (e) => {
      // `;` toggles the mode. Never steal it from a text field.
      if (e.key === ';' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingTarget(e.target)) return false;
        e.preventDefault();
        setActive((prev) => !prev);
        return true;
      }

      if (!active) return false;

      // ArrowLeft → back one page. Skip when typing so caret movement still works.
      if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingTarget(e.target)) return false;
        e.preventDefault();
        useSystemStore.getState().navigateBack();
        return true;
      }

      // Esc exits the mode. Don't consume the event — a modal underneath should
      // still get its own Escape handling.
      if (e.key === 'Escape') {
        setActive(false);
        return false;
      }

      return false;
    },
    // Above the cheat-sheet (20) and workspace (15) handlers so ArrowLeft is
    // reliably claimed for Back while the mode is active.
    { priority: 30 },
  );

  if (!active) return null;

  return (
    <div
      className="kbd-nav-glow"
      data-testid="keyboard-nav-glow"
      aria-hidden="true"
    />
  );
}
