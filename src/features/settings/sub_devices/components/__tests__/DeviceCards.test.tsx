import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { OwnedDevice } from '@/api/network/devices';
import type { DiscoveredPeer } from '@/api/network/discovery';
import { DeviceCards } from '../DeviceCards';

function device(over: Partial<OwnedDevice>): OwnedDevice {
  return {
    peerId: 'peer-a',
    deviceGroupId: 'group-1',
    displayName: 'Studio PC',
    addedAt: '2026-11-01T10:00:00Z',
    lastSyncedAt: null,
    isHome: false,
    pairedAt: '2026-11-01T10:00:00Z',
    publicKey: 'key',
    ...over,
  };
}

function peer(peerId: string, isConnected: boolean): DiscoveredPeer {
  return {
    peer_id: peerId,
    display_name: peerId,
    addresses: [],
    last_seen_at: '2026-11-05T10:00:00Z',
    first_seen_at: '2026-11-01T10:00:00Z',
    is_connected: isConnected,
    metadata: null,
  } as DiscoveredPeer;
}

function renderCards(props: Partial<Parameters<typeof DeviceCards>[0]> = {}) {
  const onOpen = vi.fn();
  const onAdd = vi.fn();
  render(
    <DeviceCards
      devices={[]}
      discoveredPeers={[]}
      isLoading={false}
      selectedPeerId={null}
      onOpen={onOpen}
      onAdd={onAdd}
      {...props}
    />,
  );
  return { onOpen, onAdd };
}

describe('DeviceCards', () => {
  it('shows ghost cards on the first load, not the empty state', () => {
    renderCards({ isLoading: true });
    expect(screen.getAllByTestId('device-card-ghost')).toHaveLength(2);
    expect(screen.queryByTestId('devices-empty')).toBeNull();
  });

  it('keeps rendered cards during a refetch', () => {
    renderCards({ isLoading: true, devices: [device({})] });
    expect(screen.queryByTestId('device-card-ghost')).toBeNull();
    expect(screen.getByText('Studio PC')).toBeTruthy();
  });

  it('shows the empty state with an Add a PC action when nothing is paired', () => {
    const { onAdd } = renderCards();
    expect(screen.getByTestId('devices-empty').textContent).toContain('Only this PC so far');
    fireEvent.click(screen.getByTestId('devices-empty-add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('names reachability in plain words', () => {
    renderCards({
      devices: [
        device({ peerId: 'on', displayName: 'Online PC' }),
        device({ peerId: 'lan', displayName: 'Lan PC' }),
        device({ peerId: 'gone', displayName: 'Gone PC' }),
      ],
      discoveredPeers: [peer('on', true), peer('lan', false)],
    });
    expect(screen.getByTestId('device-reach-on').textContent).toBe('Online');
    expect(screen.getByTestId('device-reach-lan').textContent).toBe('On this network');
    expect(screen.getByTestId('device-reach-gone').textContent).toBe('Not seen lately');
  });

  it('says "Not synced yet" when the PC never synced, and shows no raw id', () => {
    renderCards({ devices: [device({ peerId: '12D3KooWrawpeerid' })] });
    const card = screen.getByTestId('device-card-12D3KooWrawpeerid');
    expect(card.textContent).toContain('Not synced yet');
    expect(card.textContent).not.toContain('12D3KooW');
  });

  it('badges only the main PC', () => {
    renderCards({ devices: [device({ peerId: 'main', isHome: true }), device({ peerId: 'other' })] });
    expect(screen.getByTestId('device-main-badge-main').textContent).toBe('Main PC');
    expect(screen.queryByTestId('device-main-badge-other')).toBeNull();
  });

  it('opens the drawer from the whole card', () => {
    const d = device({});
    const { onOpen } = renderCards({ devices: [d] });
    fireEvent.click(screen.getByRole('button', { name: 'Studio PC' }));
    expect(onOpen).toHaveBeenCalledWith(d);
  });
});
