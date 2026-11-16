/**
 * Revocation failures on the API Keys page: they must be shown (and survive the
 * reload that follows), traced to telemetry, and keep every in-flight row
 * disabled until its own call settles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';

const traced = vi.fn();
vi.mock('@/lib/silentCatch', async (orig) => ({
  ...(await orig<typeof import('@/lib/silentCatch')>()),
  silentCatch: (ctx: string) => (e: unknown) => traced(ctx, e),
}));

const list = vi.fn();
const revokeKey = vi.fn();
const deleteKey = vi.fn();
const revokePairingMock = vi.fn();
vi.mock('@/api/auth/externalApiKeys', () => ({
  listExternalApiKeys: (...a: unknown[]) => list(...a),
  createExternalApiKey: vi.fn(),
  revokeExternalApiKey: (...a: unknown[]) => revokeKey(...a),
  deleteExternalApiKey: (...a: unknown[]) => deleteKey(...a),
}));
vi.mock('@/api/auth/pairing', () => ({ revokePairing: (...a: unknown[]) => revokePairingMock(...a) }));
vi.mock('./McpServerInfoPanel', () => ({ McpServerInfoPanel: () => null }));
vi.mock('./GigPersonaPolicySection', () => ({ GigPersonaPolicySection: () => null }));
vi.mock('@/features/settings/shared/RecentChangeChip', () => ({ RecentChangeChip: () => null }));

import ApiKeysSettings from './ApiKeysSettings';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const recent = new Date(Date.now() - 86_400_000).toISOString();
function mk(id: string, extra: Partial<ExternalApiKey> = {}): ExternalApiKey {
  return {
    id,
    name: `Key ${id}`,
    key_prefix: `pk_${id}`,
    scopes: '[]',
    enabled: true,
    created_at: recent,
    last_used_at: recent,
    revoked_at: null,
    expires_at: null,
    bound_origin: null,
    label: null,
    ...extra,
  };
}

/** Arm then confirm the first button with this label inside a row. */
function confirmIn(row: HTMLElement, label: string) {
  fireEvent.click(within(row).getByText(label).closest('button')!);
  fireEvent.click(within(row).getByText('Confirm').closest('button')!);
}
const rowOf = (name: string) => screen.getByText(name).closest('div.rounded-card') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ApiKeysSettings revocation', () => {
  it('keeps the failure message visible after a partially failed Disconnect', async () => {
    list.mockResolvedValue([
      mk('p1', { bound_origin: 'https://app.example', name: 'Pair one' }),
      mk('p2', { bound_origin: 'https://app.example', name: 'Pair two', created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
    ]);
    revokePairingMock.mockImplementation(async (id: string) => {
      if (id === 'p2') throw new Error('revoke blocked');
    });
    render(<ApiKeysSettings />);
    const row = await screen.findByTestId('connected-app-row');
    confirmIn(row, 'Disconnect');
    await waitFor(() => expect(revokePairingMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('revoke blocked')).not.toBeNull();
  });

  it('traces failed revoke, delete and disconnect to telemetry', async () => {
    list.mockResolvedValue([
      mk('a'),
      mk('b'),
      mk('p1', { bound_origin: 'https://app.example', name: 'Pair one' }),
    ]);
    revokeKey.mockRejectedValue(new Error('rv fail'));
    deleteKey.mockRejectedValue(new Error('del fail'));
    revokePairingMock.mockRejectedValue(new Error('dc fail'));
    render(<ApiKeysSettings />);
    await screen.findByText('Key a');
    confirmIn(rowOf('Key a'), 'Revoke');
    await waitFor(() => expect(traced).toHaveBeenCalledTimes(1));
    confirmIn(rowOf('Key b'), 'Delete');
    await waitFor(() => expect(traced).toHaveBeenCalledTimes(2));
    confirmIn(screen.getByTestId('connected-app-row'), 'Disconnect');
    await waitFor(() => expect(traced).toHaveBeenCalledTimes(3));
    const contexts = traced.mock.calls.map((c) => c[0]);
    expect(contexts).toEqual([
      'ApiKeysSettings:revoke',
      'ApiKeysSettings:delete',
      'ApiKeysSettings:disconnect',
    ]);
  });

  it('keeps both rows disabled while two revokes are in flight', async () => {
    list.mockResolvedValue([mk('a'), mk('b')]);
    revokeKey.mockImplementation(() => new Promise(() => {}));
    render(<ApiKeysSettings />);
    await screen.findByText('Key a');
    confirmIn(rowOf('Key a'), 'Revoke');
    confirmIn(rowOf('Key b'), 'Revoke');
    await waitFor(() => expect(revokeKey).toHaveBeenCalledTimes(2));
    for (const name of ['Key a', 'Key b']) {
      const buttons = within(rowOf(name)).getAllByRole('button');
      const disabled = buttons.filter((b) => (b as HTMLButtonElement).disabled);
      expect(disabled.length, name).toBe(2);
    }
  });
});
