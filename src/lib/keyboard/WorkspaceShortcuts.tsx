import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useSystemStore } from '@/stores/systemStore';
import { SIDEBAR_TOGGLE_EVENT } from '@/features/shared/chrome/DesktopFooter';

/**
 * App-global workspace toggles. Mounted once near the app root (alongside
 * `ShortcutCheatSheet`) so the bindings work from anywhere.
 *
 * Windows-focused, collision-aware scheme (WebView2 is Edge-based, so we
 * dodge Edge/Windows reserved combos):
 *   - Ctrl/⌘ + B  → collapse / expand the sidebar (VS Code convention)
 *   - Ctrl/⌘ + M  → open / close the Persona Monitor grid (no Edge/Windows default)
 *   - Alt/⌥ + A   → open / close the Athena chat (Ctrl+A = select-all and
 *                   Ctrl+J = Edge downloads both collide, so Alt+A; A = Athena)
 *
 * Registry entries live in `shortcutRegistry.ts` so the `?` cheat-sheet stays
 * in sync. These never fire while the user is typing into a field.
 */

/** Don't hijack shortcuts while the user is typing into a field. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export default function WorkspaceShortcuts() {
  useAppKeyboard(
    (e) => {
      if (isTypingTarget(e.target)) return false;
      const mod = e.metaKey || e.ctrlKey;

      // Ctrl/⌘ + B — toggle the sidebar (consumed by Sidebar via custom event).
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT));
        return true;
      }

      // Ctrl/⌘ + M — toggle the Persona Monitor grid (via the unified
      // header-overlay controller, so it closes Notifications if open).
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        const sys = useSystemStore.getState();
        sys.setHeaderOverlay(sys.headerOverlay === 'monitor' ? 'none' : 'monitor');
        return true;
      }

      // Alt/⌥ + A — toggle the Athena chat. Mirrors the footer icon's logic:
      // with the floating orb on, summon/hide the orb; otherwise open/collapse
      // the chat panel directly. No-op when the companion footer is disabled.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        const sys = useSystemStore.getState();
        if (!sys.companionFooterEnabled) return false;
        e.preventDefault();
        void import('@/features/plugins/companion/companionStore').then(({ useCompanionStore }) => {
          const orbEnabled = useSystemStore.getState().companionOrbEnabled;
          const { state, setState } = useCompanionStore.getState();
          if (orbEnabled) {
            setState(state === 'minimized' ? 'collapsed' : 'minimized');
          } else {
            setState(state === 'open' ? 'collapsed' : 'open');
          }
        });
        return true;
      }

      return false;
    },
    { priority: 15 },
  );

  return null;
}
