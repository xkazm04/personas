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

  it('builds the agent-action rows, section headings and edit toasts from the catalog', () => {
    const utils = read('src/features/shared/chrome/commandPaletteUtils.ts');
    const palette = read('src/features/shared/chrome/CommandPalette.tsx');
    for (const literal of ["'Execute ad-hoc'", "'Clone agent'", "'Full editor'", "'Run Health Check'", "'System diagnostics'", "'Currently on'"]) {
      expect(utils).not.toContain(literal);
    }
    for (const literal of ["'Agent Actions'", "'Recent Agents'", "'Credentials'", "'Agent updated'", "'Failed to update agent'"]) {
      expect(palette).not.toContain(literal);
    }
    expect(utils).toContain('t.chrome.palette_run_agent');
    expect(palette).toContain('t.chrome.palette_section_agent_actions');
  });

  it('names the sidebar landmarks through translations', () => {
    const src = read('src/features/shared/chrome/sidebar/Sidebar.tsx');
    expect(src).not.toContain('aria-label="Primary"');
    expect(src).not.toContain("'Navigation drawer'");
    expect(src).toContain('t.sidebar.primary_nav');
    expect(src).toContain('t.sidebar.navigation_drawer');
  });

  it('labels the rail count badges through the catalog', () => {
    const src = read('src/features/shared/chrome/sidebar/SidebarLevel1.tsx');
    expect(src).not.toContain('pending review${');
    expect(src).not.toContain('unread message${');
    expect(src).toContain('t.sidebar.pending_reviews_sr_other');
    expect(src).toContain('t.sidebar.unread_reports_sr_other');
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
        'palette_run_agent', 'palette_run_hint', 'palette_enable_agent', 'palette_disable_agent',
        'palette_state_on', 'palette_state_off', 'palette_duplicate_agent', 'palette_duplicate_hint',
        'palette_quick_edit_agent', 'palette_quick_edit_hint', 'palette_open_agent', 'palette_open_hint',
        'palette_health_check', 'palette_health_check_hint', 'palette_section_commands',
        'palette_section_agent_actions', 'palette_section_recent_agents', 'palette_section_agents',
        'palette_section_credentials', 'palette_section_templates', 'palette_section_automations',
        'palette_section_navigation', 'palette_agent_updated', 'palette_update_failed',
      ]) {
        expect(json.chrome[k], `${code}.chrome.${k}`).toBeTruthy();
      }
      for (const k of ['primary_nav', 'navigation_drawer']) {
        expect(json.sidebar[k], `${code}.sidebar.${k}`).toBeTruthy();
      }
    }
  });
});
