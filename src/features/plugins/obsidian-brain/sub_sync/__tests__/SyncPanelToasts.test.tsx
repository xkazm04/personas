/**
 * SyncPanel — push/pull toasts speak the user's language.
 *
 * Before: `Push: 2 created, 1 updated, 0 skipped` and a second
 * `Both sides edited ...` toast were English template literals in every
 * locale, repeating the SyncResultCard rendered right below them.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

vi.mock('@/api/obsidianBrain', () => ({
  obsidianBrainPushSync: vi.fn(async () => ({ created: 2, updated: 1, skipped: 0, errors: [] })),
  obsidianBrainPullSync: vi.fn(async () => ({ created: 1, updated: 0, conflicts: [], converged: 2, errors: [] })),
  obsidianBrainGetSyncLog: vi.fn(async () => []),
  obsidianBrainResolveConflict: vi.fn(),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ personas: [{ id: 'p1', name: 'Scout' }] }),
}));
vi.mock('../../SavedConfigsSidebar', () => ({ default: () => null }));

import SyncPanel from '../SyncPanel';
import { AriaLiveProvider } from '@/features/shared/components/feedback/AriaLiveProvider';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

describe('SyncPanel toasts', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    useSystemStore.setState({ obsidianConnected: true, obsidianVaultPath: '/v', obsidianVaultName: 'v' });
  });

  it('announces a push with the localized headline', async () => {
    render(<AriaLiveProvider><SyncPanel /></AriaLiveProvider>);
    fireEvent.click(await screen.findByText('Scout'));
    fireEvent.click(screen.getByText(/Push to Vault/));

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBe(1));
    expect(useToastStore.getState().toasts[0]?.message).toBe('Pushed 3');
  });

  it('announces a pull once, convergence included in the count', async () => {
    render(<AriaLiveProvider><SyncPanel /></AriaLiveProvider>);
    fireEvent.click(await screen.findByText(/Pull from Vault/));

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toEqual(['Pulled 3']);
  });
});
