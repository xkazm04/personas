/**
 * Enter must run the HIGHLIGHTED row. The palette paints its results grouped
 * by kind (Commands, then Agent Actions) but used to execute
 * `items[selectedIndex]` from the ranked, ungrouped list. In command mode
 * "Run Health Check" is an agent-action that ranks among the static commands,
 * so for `>r` it ranks first (prefix match, 90) while the first painted (and
 * highlighted) row is "Create New Agent" (substring, 80): Enter ran the
 * system health check.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const { healthCheck, setSidebarSection, setHeaderOverlay, sel } = vi.hoisted(() => ({
  healthCheck: vi.fn(() => Promise.resolve({})),
  setSidebarSection: vi.fn(),
  setHeaderOverlay: vi.fn(),
  sel: <S,>(state: S) => (selector: (s: S) => unknown) => selector(state),
}));
vi.mock('@/api/system/system', () => ({ systemHealthCheck: () => healthCheck() }));
vi.mock('@/api/agents/executions', () => ({ executePersona: vi.fn(() => Promise.resolve()) }));
vi.mock('@/api/agents/personas', () => ({ duplicatePersona: vi.fn() }));
vi.mock('@/features/agents/components/QuickEditPanel', () => ({ QuickEditPanel: () => null }));
vi.mock('@/features/settings/search/useSettingsSearchEntries', () => ({
  useSettingsSearchEntries: () => ({ all: [], recommended: [] }),
}));
vi.mock('@/lib/keyboard/AppKeyboardProvider', () => ({ useAppKeyboard: () => {} }));
vi.mock('@/i18n/useSidebarTranslation', () => ({ useSidebarLabels: () => (_id: string, label: string) => label }));

vi.mock('@/i18n/useTranslation', async () => {
  const common = (await import('@/i18n/section-locales/en/common.json')).default;
  const chrome = (await import('@/i18n/section-locales/en/chrome.json')).default;
  const agents = (await import('@/i18n/section-locales/en/agents.json')).default;
  const settings = (await import('@/i18n/section-locales/en/settings.json')).default;
  const shared = (await import('@/i18n/section-locales/en/shared.json')).default;
  return {
    // INVARIANT for the cast: these JSON files are what the generated proxy is
    // built from, so the shape matches for every key the palette reads.
    useTranslation: () => ({
      t: { common, chrome, agents, settings, shared } as never,
      tx: (s: string, vars: Record<string, unknown> = {}) =>
        s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? '')),
    }),
  };
});

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: sel({ setSidebarSection, setHeaderOverlay, setIsCreatingPersona: vi.fn() }),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: sel({ personas: [], selectPersona: vi.fn(), updatePersona: vi.fn(), fetchPersonas: vi.fn() }),
}));
vi.mock('@/stores/pipelineStore', () => ({ usePipelineStore: sel({ teams: [], recipes: [] }) }));
vi.mock('@/stores/vaultStore', () => ({ useVaultStore: sel({ credentials: [], automations: [] }) }));
vi.mock('@/stores/toastStore', () => ({ useToastStore: sel({ addToast: vi.fn() }) }));
vi.mock('@/stores/commandPaletteStore', () => ({
  useCommandPaletteStore: sel({ open: true, scope: 'all', togglePalette: vi.fn(), closePalette: vi.fn() }),
}));

import CommandPalette from '../CommandPalette';

// jsdom has no layout; the palette scrolls the highlighted row into view.
Element.prototype.scrollIntoView = () => {};

describe('command palette Enter', () => {
  it('runs the highlighted row, not the ranked-list row at the same index', async () => {
    render(<CommandPalette />);
    const input = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(input, { target: { value: '>r' } }); });

    const rows = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-index'));
    const highlighted = rows.find((r) => r.getAttribute('data-index') === '0')!;
    // Precondition: the first painted row is a static command, and the health
    // check is ranked but painted under the second heading.
    expect(highlighted.textContent).toContain('Create New Agent');
    expect(rows.some((r) => r.textContent?.includes('Run Health Check'))).toBe(true);

    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });

    expect(healthCheck).not.toHaveBeenCalled();
    expect(setSidebarSection).toHaveBeenCalledWith('personas');
  });
});
