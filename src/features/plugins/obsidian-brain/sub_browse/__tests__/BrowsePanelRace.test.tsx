/**
 * BrowsePanel — a slow note read must not land under a newer selection.
 *
 * Fixture: two notes; the read for the first is held open while the user
 * clicks the second, then released. Before the latest-wins guard the first
 * body overwrote the second under the second note's title.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

const readNote = vi.fn();
vi.mock('@/api/obsidianBrain', () => ({
  obsidianBrainListVaultFiles: async () => ({
    name: 'vault',
    path: '',
    isDir: true,
    noteCount: 2,
    children: [
      { name: 'first.md', path: 'first.md', isDir: false, noteCount: 0, children: [] },
      { name: 'second.md', path: 'second.md', isDir: false, noteCount: 0, children: [] },
    ],
  }),
  obsidianBrainReadVaultNote: (p: string) => readNote(p),
}));

const systemState = {
  obsidianConnected: true,
  obsidianVaultPath: '/vault',
  obsidianVaultName: 'vault',
  setObsidianBrainTab: vi.fn(),
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) => selector(systemState),
}));
vi.mock('../../SavedConfigsSidebar', () => ({ default: () => null }));

import BrowsePanel from '../BrowsePanel';

describe('BrowsePanel note preview', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });

  it('keeps the newest selection when an older read resolves last', async () => {
    let releaseFirst!: (body: string) => void;
    readNote.mockImplementation((p: string) =>
      p === 'first.md'
        ? new Promise<string>((r) => { releaseFirst = r; })
        : Promise.resolve('second body text'),
    );

    render(<BrowsePanel />);
    fireEvent.click(await screen.findByText('first.md'));
    fireEvent.click(screen.getByText('second.md'));
    expect(await screen.findByText('second body text')).toBeTruthy();

    await act(async () => { releaseFirst('first body text'); });

    expect(screen.queryByText('first body text')).toBeNull();
    expect(screen.getByText('second body text')).toBeTruthy();
  });
});
