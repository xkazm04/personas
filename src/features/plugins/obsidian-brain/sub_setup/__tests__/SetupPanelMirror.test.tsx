/**
 * SetupPanel knowledge mirror — a failed backfill keeps the saved switch.
 *
 * Turning the execution-knowledge mirror on saves the setting, then backfills
 * existing rows. Before: a backfill failure fell into the save's catch and
 * flipped the switch back OFF while the backend kept the mirror ON.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

const setMirror = vi.fn(async () => undefined);
const backfill = vi.fn();
vi.mock('@/api/obsidianBrain', () => ({
  obsidianBrainDetectVaults: vi.fn(async () => []),
  obsidianBrainTestConnection: vi.fn(),
  obsidianBrainSaveConfig: vi.fn(),
  obsidianMirrorGetConfig: vi.fn(async () => ({ executionKnowledge: false, athena: false })),
  obsidianMirrorSetConfig: (c: unknown) => setMirror(c),
  obsidianAvailable: vi.fn(async () => ({ available: true })),
  obsidianMirrorBackfillExecutionKnowledge: () => backfill(),
  obsidianBrainListSavedVaults: vi.fn(async () => []),
  obsidianBrainSetSavedVaults: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../../SavedConfigsSidebar', () => ({ default: () => null }));

import SetupPanel from '../SetupPanel';
import { useToastStore } from '@/stores/toastStore';

describe('SetupPanel knowledge mirror', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });

  it('keeps the mirror on when only the backfill fails', async () => {
    backfill.mockRejectedValue({ error: 'database is locked', kind: 'Database' });

    render(<SetupPanel />);
    const row = await screen.findByTestId('mirror-toggle-executionKnowledge');
    const toggle = row.querySelector('[role="switch"]') as HTMLElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(backfill).toHaveBeenCalledTimes(1));
    expect(setMirror).toHaveBeenCalledWith({ executionKnowledge: true, athena: false });
    // The failure is reported once it settles...
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBe(1));
    // ...and the switch still shows the saved state.
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('names the vault path field for assistive tech', async () => {
    render(<SetupPanel />);
    expect(await screen.findByRole('textbox', { name: /Vault path/ })).toBeTruthy();
  });
});
