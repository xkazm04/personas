import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

const CONFIG = {
  vaultPath: 'C:/vaults/notes',
  vaultName: 'notes',
  syncMemories: true,
  syncPersonas: true,
  syncConnectors: false,
  autoSync: false,
  folderMapping: { memoriesFolder: 'memories', personasFolder: 'Personas', connectorsFolder: 'Connectors' },
};

const saveConfig = vi.fn();
const setSavedVaults = vi.fn(async (_v: unknown): Promise<void> => undefined);
vi.mock('@/api/obsidianBrain', () => ({
  obsidianBrainSaveConfig: (c: unknown) => saveConfig(c),
  obsidianBrainListSavedVaults: async () => [CONFIG],
  obsidianBrainSetSavedVaults: (v: unknown) => setSavedVaults(v),
}));

import SavedConfigsSidebar from '../SavedConfigsSidebar';
import { useToastStore } from '@/stores/toastStore';

describe('SavedConfigsSidebar', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });
  beforeEach(() => {
    saveConfig.mockReset();
    setSavedVaults.mockReset();
    setSavedVaults.mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('names the backend reason when activating a vault fails', async () => {
    // invokeWithTimeout rejects with a serialized AppError object, not an Error.
    saveConfig.mockRejectedValue({ error: 'Vault folder no longer exists', kind: 'NotFound' });

    render(<SavedConfigsSidebar />);
    fireEvent.click(await screen.findByText('notes'));

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBe(1));
    const message = useToastStore.getState().toasts[0]?.message ?? '';
    expect(message).toContain('Vault folder no longer exists');
    expect(message).not.toContain('[object Object]');
  });

  it('rolls the roster back and reports an error when the write is rejected', async () => {
    setSavedVaults.mockRejectedValue({ error: 'disk full', kind: 'Io' });

    render(<SavedConfigsSidebar />);
    await screen.findByText('notes');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
    const toasts = useToastStore.getState().toasts;
    expect(toasts.every((x) => x.type === 'error')).toBe(true);
    // The vault is back in the list: the removal never persisted.
    await waitFor(() => expect(screen.getByText('notes')).toBeTruthy());
  });
});
