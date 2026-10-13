// The device strip renders NOTHING until a device is paired (no empty chrome
// for a one-machine operator), and once one is: 'All', this device, then one
// plate per peer, a stale peer greyed with "last seen", a plate scoping the
// board and the same plate un-scoping it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The 5 s liveness tick is the slice's (`meshSlice.test.ts`); here it would only
// settle outside act().
vi.mock('@/hooks/utility/timing/usePolling', async (orig) => ({
  ...(await orig<typeof import('@/hooks/utility/timing/usePolling')>()),
  usePolling: () => undefined,
}));
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import { useSystemStore } from '@/stores/systemStore';
import { DeviceStrip } from '../DeviceStrip';

const device = (peerId: string, over: Partial<MeshDeviceView> = {}): MeshDeviceView => ({
  peerId, displayName: peerId, isSelf: false, isHome: false, reachability: 'connected', liveness: 'live',
  receivedAtMs: Date.now(), lastProbe: null,
  snapshot: {
    peerId, displayName: peerId, appVersion: '1', sentAtMs: Date.now(),
    host: { cpuShare: 0.4, ramShare: 0.2, gpuShare: null }, running: 1, queued: 2, agents: [], queue: [],
  },
  ...over,
});

function seed(devices: MeshDeviceView[]) {
  // Pinned: the strip's mount-time reconcile read is skipped.
  act(() => {
    useSystemStore.setState({ meshPinned: true, meshDevices: [], meshLiveness: {}, meshFilter: 'all' });
    for (const d of devices) useSystemStore.getState().applyDeviceSnapshot(d);
  });
}

describe('DeviceStrip', () => {
  beforeEach(() => seed([]));
  afterEach(() => act(() => { useSystemStore.setState({ meshPinned: false, meshDevices: [], meshLiveness: {}, meshFilter: 'all' }); }));

  it('renders nothing with no devices at all', () => {
    const { container } = render(<DeviceStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the only device is this one', () => {
    seed([device('me', { isSelf: true })]);
    const { container } = render(<DeviceStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('with a paired device: All, this device, then each peer; a stale peer reads last seen', () => {
    seed([
      device('me', { isSelf: true }),
      device('studio'),
      device('laptop', { liveness: 'unknown', reachability: 'offline', receivedAtMs: Date.now() - 6 * 60_000 }),
    ]);
    render(<DeviceStrip />);
    expect(screen.getByTestId('mesh-plate-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mesh-plate-self')).toBeInTheDocument();
    const peers = screen.getAllByTestId('mesh-plate');
    expect(peers.map((p) => p.getAttribute('data-peer-id'))).toEqual(['studio', 'laptop']);
    expect(peers[0]).toHaveAttribute('data-liveness', 'live');
    expect(peers[1]).toHaveAttribute('data-liveness', 'unknown');
    expect(screen.getAllByTestId('mesh-plate-last-seen')).toHaveLength(1);
    // A null GPU draws no bar: two axes on the live peer's plate.
    expect(peers[0]!.querySelectorAll('[data-axis]')).toHaveLength(2);
  });

  it('a plate scopes the board, and pressing it again returns to All', () => {
    seed([device('me', { isSelf: true }), device('studio')]);
    render(<DeviceStrip />);
    const plate = screen.getByTestId('mesh-plate');
    fireEvent.click(plate);
    expect(useSystemStore.getState().meshFilter).toBe('studio');
    expect(screen.getByTestId('mesh-plate')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('mesh-plate'));
    expect(useSystemStore.getState().meshFilter).toBe('all');
  });
});
