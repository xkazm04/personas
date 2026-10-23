/**
 * GraphPanel — switching vaults drops the previous vault's search hits.
 *
 * A hit is a path inside the vault it came from; once the active vault
 * changes, clicking it deep-links the NEW vault's name to the OLD vault's
 * path. Before this change the hits survived the switch.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

const obsidianGraphSearch = vi.fn();
vi.mock('@/api/obsidianBrain', () => ({
  obsidianGraphSearch: (...a: unknown[]) => obsidianGraphSearch(...a),
  obsidianGraphStats: vi.fn(async () => ({ totalNotes: 1, totalLinks: 0, orphanCount: 0, mocCount: 0, dailyNoteCount: 0 })),
  obsidianGraphListOrphans: vi.fn(async () => []),
  obsidianGraphListMocs: vi.fn(async () => []),
  obsidianGraphAppendDailyNote: vi.fn(),
  obsidianGraphWriteMeetingNote: vi.fn(),
  obsidianGraphStartWatcher: vi.fn(async () => {}),
  obsidianGraphStopWatcher: vi.fn(async () => {}),
  VAULT_CHANGED_EVENT: 'vault:changed',
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));

const systemState: Record<string, unknown> = {
  obsidianConnected: true,
  obsidianVaultPath: '/vault-a',
  obsidianVaultName: 'vault-a',
  setObsidianBrainTab: vi.fn(),
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) => selector(systemState),
}));
vi.mock('../../SavedConfigsSidebar', () => ({ default: () => null }));

import GraphPanel from '../GraphPanel';

describe('GraphPanel vault switch', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });

  it('clears search hits that belong to the previous vault', async () => {
    obsidianGraphSearch.mockResolvedValue([{ path: 'a/only-in-a.md', title: 'Only in A', snippet: 'x', score: 3 }]);

    const { rerender } = render(<GraphPanel />);
    const input = await screen.findByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'only' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Only in A')).toBeTruthy();

    systemState.obsidianVaultPath = '/vault-b';
    systemState.obsidianVaultName = 'vault-b';
    rerender(<GraphPanel />);

    await waitFor(() => expect(screen.queryByText('Only in A')).toBeNull());
  });
});
