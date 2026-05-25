import type { Translations } from '@/i18n/en';

/**
 * Single source of truth for the app's discoverable keyboard shortcuts.
 *
 * The cheat-sheet overlay (`ShortcutCheatSheet`) renders directly from this
 * registry, so the documentation can never drift from a hand-maintained list
 * elsewhere. When you wire a new global binding through `useAppKeyboard`, add
 * a matching entry here so it shows up in the `?` overlay.
 */

/** Custom DOM event that opens the cheat-sheet from anywhere (e.g. the footer). */
export const SHORTCUTS_OPEN_EVENT = 'personas:shortcuts-open';

/**
 * macOS uses ⌘ / ⇧ glyphs; every other platform shows the spelled-out
 * modifier. Tauri's webview userAgent is stable per platform, so resolving
 * once at module load is safe.
 */
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

/**
 * Resolve a key token to its display glyph. `mod` and `shift` are
 * platform-aware; every other token renders verbatim.
 */
export function resolveKeyToken(token: string): string {
  if (token === 'mod') return IS_MAC ? '⌘' : 'Ctrl';
  if (token === 'shift') return IS_MAC ? '⇧' : 'Shift';
  if (token === 'alt') return IS_MAC ? '⌥' : 'Alt';
  return token;
}

export type ShortcutSectionId = 'navigation' | 'workspace' | 'agents' | 'editing';

export interface ShortcutBinding {
  /**
   * Alternative key-combos for the same action. Each inner array is one combo
   * rendered as adjacent `<kbd>` chips; multiple combos render joined by "/".
   * Tokens `mod` / `shift` are resolved per-platform by `resolveKeyToken`.
   */
  combos: string[][];
  /** Human description, resolved against the active translation tree. */
  describe: (t: Translations) => string;
}

export interface ShortcutGroup {
  section: ShortcutSectionId;
  title: (t: Translations) => string;
  bindings: ShortcutBinding[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    section: 'navigation',
    title: (t) => t.chrome.shortcuts.section_navigation,
    bindings: [
      { combos: [['mod', 'K']], describe: (t) => t.chrome.shortcuts.command_palette },
      { combos: [['?'], ['mod', '/']], describe: (t) => t.chrome.shortcuts.show_shortcuts },
      { combos: [['Esc']], describe: (t) => t.chrome.shortcuts.close_overlay },
    ],
  },
  {
    section: 'workspace',
    title: (t) => t.chrome.shortcuts.section_workspace,
    bindings: [
      // Windows-focused, collision-aware (WebView2 is Edge-based): Ctrl+B is
      // the VS Code sidebar convention; Ctrl+M has no Edge/Windows default;
      // Alt+A avoids Ctrl+A (select-all) and Ctrl+J (Edge downloads).
      { combos: [['mod', 'B']], describe: (t) => t.chrome.shortcuts.toggle_sidebar },
      { combos: [['mod', 'M']], describe: (t) => t.chrome.shortcuts.toggle_monitor },
      { combos: [['alt', 'A']], describe: (t) => t.chrome.shortcuts.toggle_athena },
    ],
  },
  {
    section: 'agents',
    title: (t) => t.chrome.shortcuts.section_agents,
    bindings: [
      { combos: [['←'], ['A']], describe: (t) => t.chrome.shortcuts.triage_reject },
      { combos: [['→'], ['Z']], describe: (t) => t.chrome.shortcuts.triage_accept },
    ],
  },
  {
    section: 'editing',
    title: (t) => t.chrome.shortcuts.section_editing,
    bindings: [
      { combos: [['mod', 'Z']], describe: (t) => t.chrome.shortcuts.undo },
      { combos: [['mod', 'shift', 'Z']], describe: (t) => t.chrome.shortcuts.redo },
    ],
  },
];
