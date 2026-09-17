import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The palette's agent actions and the sidebar's landmark names used to be
 * English literals inside an otherwise translated shell, so a `ja` user got a
 * translated search box that announced its results in English. These are
 * source-level assertions because the strings live in a `.then()` callback and
 * an `aria-label`, neither of which a render test reaches without standing up
 * the whole app shell.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const LOCALES = ['en', 'ar', 'bn', 'cs', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];

describe('command palette + sidebar copy is translated', () => {
  it('carries no English toast literals in the palette agent actions', () => {
    const src = read('src/features/shared/chrome/CommandPalette.tsx');
    for (const literal of [
      "'Execution started'",
      "'Failed to start execution'",
      "'Failed to toggle agent'",
      "'Health check complete'",
      "'Health check failed'",
      "enabled ? 'enabled' : 'disabled'",
    ]) {
      expect(src).not.toContain(literal);
    }
    expect(src).toContain('t.agents.executions.execution_started');
    expect(src).toContain('t.chrome.palette_agent_enabled');
  });

  it('names the sidebar landmarks through translations', () => {
    const src = read('src/features/shared/chrome/sidebar/Sidebar.tsx');
    expect(src).not.toContain('aria-label="Primary"');
    expect(src).not.toContain("'Navigation drawer'");
    expect(src).toContain('t.sidebar.primary_nav');
    expect(src).toContain('t.sidebar.navigation_drawer');
  });

  it('has every new key in all 14 locales', () => {
    for (const code of LOCALES) {
      const json = JSON.parse(read(`src/i18n/locales/${code}.json`)) as {
        chrome: Record<string, string>;
        sidebar: Record<string, string>;
      };
      for (const k of [
        'palette_agent_enabled',
        'palette_agent_disabled',
        'palette_toggle_failed',
        'palette_health_complete',
      ]) {
        expect(json.chrome[k], `${code}.chrome.${k}`).toBeTruthy();
      }
      for (const k of ['primary_nav', 'navigation_drawer']) {
        expect(json.sidebar[k], `${code}.sidebar.${k}`).toBeTruthy();
      }
    }
  });
});
