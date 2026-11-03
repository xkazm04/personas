/** The first-run empty state carries its own next step. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/api/auth/externalApiKeys', () => ({
  listExternalApiKeys: vi.fn(async () => []),
  createExternalApiKey: vi.fn(),
  revokeExternalApiKey: vi.fn(),
  deleteExternalApiKey: vi.fn(),
}));
vi.mock('@/api/auth/pairing', () => ({ revokePairing: vi.fn() }));
vi.mock('./McpServerInfoPanel', () => ({ McpServerInfoPanel: () => null }));
vi.mock('./ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('./GigPersonaPolicySection', () => ({ GigPersonaPolicySection: () => null }));
vi.mock('./CreateApiKeyDialog', () => ({ CreateApiKeyDialog: () => <div data-testid="create-dialog" /> }));
vi.mock('@/features/settings/shared/RecentChangeChip', () => ({ RecentChangeChip: () => null }));

import ApiKeysSettings from './ApiKeysSettings';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('ApiKeysSettings empty state', () => {
  it('offers a "New key" button inside the empty state that opens the dialog', async () => {
    render(<ApiKeysSettings />);
    const empty = (await screen.findByText(/No keys yet/)).closest('[data-testid="keys-empty"]') as HTMLElement | null;
    expect(empty).not.toBeNull();
    const btn = within(empty!).queryByRole('button', { name: 'New key' });
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(screen.queryByTestId('create-dialog')).not.toBeNull();
  });
});
