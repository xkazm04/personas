import { Keyboard } from 'lucide-react';
import { SHORTCUTS_OPEN_EVENT } from '@/lib/keyboard/shortcutRegistry';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

// Keyboard-shortcuts trigger -- toggles shortcut mode; right click opens the
// global `?` cheat-sheet overlay.

export default function ShortcutsFooterIcon() {
  const { t } = useTranslation();
  const navActive = useSystemStore((s) => s.keyboardNavActive);
  const setNavActive = useSystemStore((s) => s.setKeyboardNavActive);

  // Left click toggles the keyboard "shortcut mode" (the `;` nav mode) like a
  // switch — it stays armed until toggled off, not just for one shortcut. Right
  // click opens the cheat-sheet modal with the shortcut hints.
  return (
    <button
      type="button"
      onClick={() => setNavActive(!navActive)}
      onContextMenu={(e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT));
      }}
      data-testid="footer-shortcuts"
      aria-pressed={navActive}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
        navActive
          ? 'text-primary bg-primary/15 border border-primary/25'
          : 'text-foreground hover:text-foreground hover:bg-secondary/50'
      }`}
      title={t.chrome.shortcuts.mode_toggle_title}
      aria-label={t.chrome.shortcuts.mode_toggle_aria}
    >
      <Keyboard className="w-5 h-5" />
    </button>
  );
}
