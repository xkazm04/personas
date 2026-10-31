/**
 * A first fetch that fails must not render as "still loading" or as "you have
 * no keys": the header subtitle and the empty state are both claims about the
 * key list, and after a failed first load neither is true.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/auth/externalApiKeys', () => ({
  listExternalApiKeys: vi.fn(async () => {
    throw new Error('db locked');
  }),
  createExternalApiKey: vi.fn(),
  revokeExternalApiKey: vi.fn(),
  deleteExternalApiKey: vi.fn(),
}));
vi.mock('@/api/auth/pairing', () => ({ revokePairing: vi.fn() }));
vi.mock('./McpServerInfoPanel', () => ({ McpServerInfoPanel: () => null }));
vi.mock('./ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('./GigPersonaPolicySection', () => ({ GigPersonaPolicySection: () => null }));
vi.mock('@/features/settings/shared/RecentChangeChip', () => ({ RecentChangeChip: () => null }));

import ApiKeysSettings from './ApiKeysSettings';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('ApiKeysSettings first-load failure', () => {
  it('says neither "Loading" nor "no keys" once the first fetch has failed', async () => {
    render(<ApiKeysSettings />);
    expect(await screen.findByText('db locked')).toBeTruthy();
    expect(screen.queryByText('Loading...')).toBeNull();
    expect(screen.queryByText(/No keys yet/)).toBeNull();
  });
});
