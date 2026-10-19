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
vi.mock('@/api/obsidianBrain', () => ({
  obsidianBrainSaveConfig: (c: unknown) => saveConfig(c),
  obsidianBrainListSavedVaults: async () => [CONFIG],
  obsidianBrainSetSavedVaults: async () => undefined,
}));

import SavedConfigsSidebar from '../SavedConfigsSidebar';
import { useToastStore } from '@/stores/toastStore';

describe('SavedConfigsSidebar', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });
  beforeEach(() => {
    saveConfig.mockReset();
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
});
