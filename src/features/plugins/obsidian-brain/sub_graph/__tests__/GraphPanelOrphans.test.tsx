/**
 * GraphPanel orphan tile — the stat and the list must share a predicate.
 *
 * The fixture is the one the card names: a vault whose `orphanCount` is 40
 * while `listOrphans` returns a 15-row sample. Before this change the tile was
 * an inert `<div>` and the section header interpolated 15 as if it were the
 * total; a mismatch that large was invisible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const obsidianGraphStats = vi.fn();
const obsidianGraphListOrphans = vi.fn();
const obsidianGraphListMocs = vi.fn();

vi.mock('@/api/obsidianBrain', () => ({
  obsidianGraphSearch: vi.fn(async () => []),
  obsidianGraphStats: (...a: unknown[]) => obsidianGraphStats(...a),
  obsidianGraphListOrphans: (...a: unknown[]) => obsidianGraphListOrphans(...a),
  obsidianGraphListMocs: (...a: unknown[]) => obsidianGraphListMocs(...a),
  obsidianGraphAppendDailyNote: vi.fn(),
  obsidianGraphWriteMeetingNote: vi.fn(),
  obsidianGraphStartWatcher: vi.fn(async () => {}),
  obsidianGraphStopWatcher: vi.fn(async () => {}),
  VAULT_CHANGED_EVENT: 'vault:changed',
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

// A STABLE addToast: a fresh `vi.fn()` per render would change `loadStats`'s
// identity every commit and re-fire its effect forever.
const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
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

import GraphPanel from '../GraphPanel';

function refs(n: number, from = 0) {
  return Array.from({ length: n }, (_, i) => ({ path: `n${from + i}.md`, title: `Note ${from + i}` }));
}

describe('GraphPanel orphans — count carries a predicate', () => {
  beforeEach(() => {
    obsidianGraphStats.mockReset();
    obsidianGraphListOrphans.mockReset();
    obsidianGraphListMocs.mockReset();
    obsidianGraphListMocs.mockResolvedValue([]);
    obsidianGraphStats.mockResolvedValue({
      totalNotes: 200,
      totalLinks: 500,
      orphanCount: 40,
      mocCount: 3,
      dailyNoteCount: 12,
    });
  });

  it('labels the sample and offers the tile as the control that widens it', async () => {
    obsidianGraphListOrphans.mockResolvedValue(refs(15));

    render(<GraphPanel />);

    const tile = await screen.findByTestId('vault-stat-orphans-expand');
    // The tile still reads the true total, not the sample size.
    expect(tile.textContent).toContain('40');
    // And the list beside it says it is a sample.
    expect(screen.getByText(/15 of 40/)).toBeTruthy();
  });

  it('expanding asks for the whole set and stops calling itself a sample', async () => {
    obsidianGraphListOrphans.mockResolvedValue(refs(15));

    render(<GraphPanel />);

    const tile = await screen.findByTestId('vault-stat-orphans-expand');
    obsidianGraphListOrphans.mockResolvedValue(refs(40));
    fireEvent.click(tile);

    await waitFor(() => expect(screen.queryByTestId('vault-stat-orphans-expand')).toBeNull());
    // Second call asked for far more than the sample.
    expect(obsidianGraphListOrphans.mock.calls.at(-1)?.[0]).toBeGreaterThan(15);
    expect(screen.queryByText(/15 of 40/)).toBeNull();
    expect(screen.getByTestId('vault-stat-orphans')).toBeTruthy();
  });

  it('a vault whose sample already IS the set never offers the control', async () => {
    obsidianGraphStats.mockResolvedValue({
      totalNotes: 20,
      totalLinks: 40,
      orphanCount: 3,
      mocCount: 0,
      dailyNoteCount: 0,
    });
    obsidianGraphListOrphans.mockResolvedValue(refs(3));

    render(<GraphPanel />);

    await waitFor(() => expect(screen.getByTestId('vault-stat-orphans')).toBeTruthy());
    expect(screen.queryByTestId('vault-stat-orphans-expand')).toBeNull();
  });
});
