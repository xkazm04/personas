import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredPeer } from '@/api/network/discovery';
import type { TrustedPeer } from '@/api/network/identity';

const peer: DiscoveredPeer = {
  peer_id: 'peer-1',
  display_name: 'Peer One',
  addresses: [],
  first_seen_at: '2026-10-01T00:00:00Z',
  last_seen_at: '2026-10-01T00:00:00Z',
  is_connected: false,
  metadata: null,
  trust_status: 'trusted',
};

const trustedPeer: TrustedPeer = {
  peer_id: peer.peer_id,
  public_key_b64: 'key',
  display_name: peer.display_name,
  trust_level: 'revoked',
  added_at: '2026-10-01T00:00:00Z',
  last_seen: null,
  notes: null,
};

const state = {
  discoveredPeers: [peer],
  networkStatus: { is_running: true },
  connectionStates: {},
  trustedPeers: [trustedPeer],
  networkError: null,
  fetchNetworkSnapshot: vi.fn().mockResolvedValue(undefined),
  connectToPeer: vi.fn(),
  disconnectPeer: vi.fn(),
};

afterEach(() => {
  state.discoveredPeers = [peer];
  state.networkStatus.is_running = true;
});

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (store: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { sharing: new Proxy({}, { get: (_target, key) => String(key) }) } }),
}));
vi.mock('../NetworkIcons', () => ({
  TrustVerifiedIcon: () => <svg data-testid="trust-verified" />,
  TrustUnknownIcon: () => <svg data-testid="trust-unknown" />,
  NodeConnectedIcon: () => <svg />,
  NodeDisconnectedIcon: () => <svg />,
}));
vi.mock('../PeerDetailDrawer', () => ({
  PeerDetailDrawer: ({ isTrusted }: { isTrusted: boolean }) => (
    <span data-testid="drawer-trust">{isTrusted ? 'trusted' : 'untrusted'}</span>
  ),
}));
vi.mock('@/features/shared/components/display/RelativeTime', () => ({
  RelativeTime: () => <span />,
}));

const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/log', () => ({ createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { PeerList } from '../PeerList';

describe('PeerList trust status', () => {
  it('does not present a revoked peer as trusted in the card or drawer', async () => {
    render(<PeerList />);

    const card = await screen.findByRole('button', { name: /Peer One/ });
    expect(card.querySelector('[data-testid="trust-unknown"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="trust-verified"]')).toBeNull();

    fireEvent.click(card);
    expect(screen.getByTestId('drawer-trust')).toHaveTextContent('untrusted');
  });

  it('shows a static offline state instead of scanning when discovery is stopped', async () => {
    state.discoveredPeers = [];
    state.networkStatus.is_running = false;
    const { container } = render(<PeerList />);
    await screen.findByText('status_offline');
    expect(screen.queryByText('scanning_network')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('PeerList connect failure log', () => {
  it('logs the AppError message, not [object Object]', async () => {
    // invokeWithTimeout rejects with a serialized AppError, never an Error.
    state.connectToPeer.mockRejectedValueOnce({ error: 'handshake refused', kind: 'forbidden' });
    render(<PeerList />);
    fireEvent.click(await screen.findByTitle('connect'));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to connect to peer', expect.objectContaining({ error: 'handshake refused' })));
  });
});
