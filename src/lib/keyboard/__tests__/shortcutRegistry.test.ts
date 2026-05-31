import { describe, it, expect } from 'vitest';
import type { Translations } from '@/i18n/en';
import {
  SHORTCUT_GROUPS,
  SHORTCUTS_OPEN_EVENT,
  resolveKeyToken,
} from '@/lib/keyboard/shortcutRegistry';

describe('shortcutRegistry', () => {
  it('exposes a stable open-event name', () => {
    expect(SHORTCUTS_OPEN_EVENT).toBe('personas:shortcuts-open');
  });

  it('resolveKeyToken maps mod/shift/alt to a platform glyph and passes others through', () => {
    // In jsdom navigator.platform is non-mac → spelled-out modifiers.
    expect(resolveKeyToken('mod')).toBe('Ctrl');
    expect(resolveKeyToken('shift')).toBe('Shift');
    expect(resolveKeyToken('alt')).toBe('Alt');
    expect(resolveKeyToken('K')).toBe('K');
    expect(resolveKeyToken('?')).toBe('?');
    expect(resolveKeyToken('←')).toBe('←');
  });

  it('declares the documented sections in order', () => {
    expect(SHORTCUT_GROUPS.map((g) => g.section)).toEqual([
      'navigation',
      'workspace',
      'agents',
      'editing',
    ]);
  });

  it('every binding has at least one non-empty combo and a description accessor', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.bindings.length).toBeGreaterThan(0);
      for (const binding of group.bindings) {
        expect(binding.combos.length).toBeGreaterThan(0);
        for (const combo of binding.combos) {
          expect(combo.length).toBeGreaterThan(0);
          expect(combo.every((token) => typeof token === 'string' && token.length > 0)).toBe(true);
        }
        expect(typeof binding.describe).toBe('function');
      }
    }
  });

  it('describe + title accessors resolve against the translation tree without throwing', () => {
    // Minimal stub shaped like the chrome.shortcuts slice the registry reads.
    const stub = {
      chrome: {
        shortcuts: {
          section_navigation: 'Navigation',
          section_workspace: 'Workspace',
          section_agents: 'Agents',
          section_editing: 'Editing',
          command_palette: 'Open command palette',
          show_shortcuts: 'Show keyboard shortcuts',
          close_overlay: 'Close dialog or overlay',
          nav_mode: 'Toggle keyboard navigation mode',
          nav_mode_back: 'Go back one page (in nav mode)',
          toggle_sidebar: 'Collapse / expand sidebar',
          toggle_monitor: 'Open / close Persona Monitor',
          toggle_athena: 'Open / close Athena chat',
          triage_reject: 'Reject idea',
          triage_accept: 'Accept idea',
          undo: 'Undo',
          redo: 'Redo',
        },
      },
    } as unknown as Translations;

    for (const group of SHORTCUT_GROUPS) {
      expect(group.title(stub)).toBeTruthy();
      for (const binding of group.bindings) {
        expect(binding.describe(stub)).toBeTruthy();
      }
    }
  });
});
