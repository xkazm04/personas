import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionState, DiscoveredPeer } from '@/api/network/discovery';
import { resolvePeerConnectionState } from '../peerConnectionState';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { sharing: new Proxy({}, { get: (_target, key) => String(key) }) } }),
}));
vi.mock('../NetworkIcons', () => ({
  TrustVerifiedIcon: () => <svg />,
  TrustUnknownIcon: () => <svg />,
  NodeConnectedIcon: () => <svg />,
  NodeDisconnectedIcon: () => <svg />,
}));

import { PeerCard } from '../PeerCard';

const peer = (is_connected: boolean): DiscoveredPeer => ({
  peer_id: 'peer-1',
  display_name: 'Peer One',
  addresses: [],
  first_seen_at: '2026-10-01T00:00:00Z',
  last_seen_at: '2026-10-01T00:00:00Z',
  is_connected,
  metadata: null,
  trust_status: 'trusted',
});

function renderCard(isConnected: boolean, recorded?: ConnectionState) {
  return render(
    <PeerCard
      peer={peer(isConnected)}
      connectionState={recorded}
      isTrusted
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
}

describe('resolvePeerConnectionState', () => {
  it('lets the live snapshot override a stale recorded state', () => {
    expect(resolvePeerConnectionState(peer(false), 'Connected')).toBe('Disconnected');
    expect(resolvePeerConnectionState(peer(true), 'Failed')).toBe('Connected');
    expect(resolvePeerConnectionState(peer(true), 'Disconnected')).toBe('Connected');
  });

  it('keeps what only the store knows: an attempt in flight, or a failure while still unlinked', () => {
    expect(resolvePeerConnectionState(peer(false), 'Connecting')).toBe('Connecting');
    expect(resolvePeerConnectionState(peer(false), 'Failed')).toBe('Failed');
    expect(resolvePeerConnectionState(peer(false))).toBe('Disconnected');
    expect(resolvePeerConnectionState(peer(true))).toBe('Connected');
  });
});

describe('PeerCard connection control', () => {
  it('offers Connect for a peer that dropped after a recorded connect', () => {
    renderCard(false, 'Connected');
    expect(screen.getByTitle('connect')).toBeInTheDocument();
    expect(screen.queryByTitle('disconnect')).toBeNull();
  });

  it('offers Disconnect for a peer that linked up after a recorded failure', () => {
    renderCard(true, 'Failed');
    expect(screen.getByTitle('disconnect')).toBeInTheDocument();
    expect(screen.queryByTitle('connect')).toBeNull();
  });
});
