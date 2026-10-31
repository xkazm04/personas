import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const listPendingPairings = vi.fn();
const approvePairing = vi.fn();
vi.mock('@/api/auth/pairing', () => ({
  listPendingPairings: () => listPendingPairings(),
  approvePairing: (...a: unknown[]) => approvePairing(...a),
  rejectPairing: vi.fn(),
}));
vi.mock('@/hooks/useTauriEvent', () => ({ useTauriEvent: () => {} }));

import PairApprovalModal from './PairApprovalModal';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const pairing = {
  nonce: 'n1',
  app_name: 'Cloud App',
  origin: 'https://app.example.com',
  requested_scopes: ['personas:build', 'personas:read'],
};

beforeEach(() => {
  listPendingPairings.mockReset().mockResolvedValue([pairing]);
  approvePairing.mockReset().mockResolvedValue(undefined);
});

describe('PairApprovalModal scope selection', () => {
  it('states what an empty selection still grants (read-only)', async () => {
    render(<PairApprovalModal />);
    const build = await screen.findByRole('button', { name: /personas:build/ });
    // The settings strings load lazily; wait for them before asserting on text.
    await screen.findByText('Approve');
    expect(screen.queryByText(/Read-only \(list agents/)).toBeNull();
    fireEvent.click(build);
    expect(screen.queryByText(/Read-only \(list agents/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /personas:read/ }));
    expect(screen.queryByText(/Read-only \(list agents/)).not.toBeNull();
    fireEvent.click(build);
    expect(screen.queryByText(/Read-only \(list agents/)).toBeNull();
  });
});
