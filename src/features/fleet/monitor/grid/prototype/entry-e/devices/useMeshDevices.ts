// useMeshDevices - the device strip's read on the mesh, and the only place its
// liveness clock runs.
//
// FRESHNESS. Views arrive by push (`network:device-snapshot`, one whole view
// per device, every 15 s with the peer's health tick). Snapshot-plus-stream:
// the listener attaches FIRST (a singleton that buffers what arrives before a
// subscriber is ready), and only once it is attached does the hook read the
// mesh; the read merges newest-wins per device, so it cannot clobber a push.
// It reads again on window focus, and re-decides liveness every 5 s WHILE IT
// IS MOUNTED AND A PEER EXISTS: a peer that went quiet turns `unknown` without
// a push telling us so. The tick writes the store only when an answer changes.

import { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { useSystemStore } from '@/stores/systemStore';
import { isTestBuild } from '../../../simulation/simulationMode';
import { peerDevices, selfDevice } from './meshRead';

/** The liveness tick. Finer than the 45 s bound, coarse enough to cost nothing. */
export const MESH_TICK_MS = 5_000;

// The screenshot fixture (`window.__meshFixture`) rides along in dev and
// test-automation builds only, and never in the Monitor's first chunk.
if (import.meta.env.DEV || isTestBuild()) {
  void import('@/stores/slices/network/meshFixture')
    .then((m) => m.attachMeshFixture())
    .catch(silentCatch('mesh:fixture'));
}

const useDeviceSnapshotStream = createSingletonListener<MeshDeviceView>(EventName.DEVICE_SNAPSHOT);

export function useMeshDevices() {
  const { devices, liveness, filter, setFilter, refresh, apply, tick } = useSystemStore(useShallow((s) => ({
    devices: s.meshDevices,
    liveness: s.meshLiveness,
    filter: s.meshFilter,
    setFilter: s.setMeshFilter,
    refresh: s.refreshMeshDevices,
    apply: s.applyDeviceSnapshot,
    tick: s.tickMeshLiveness,
  })));

  const attached = useDeviceSnapshotStream((view) => {
    if (view && typeof view.peerId === 'string') apply(view);
  });
  useEffect(() => {
    if (!attached) return;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [attached, refresh]);

  const peers = useMemo(() => peerDevices(devices), [devices]);
  const self = useMemo(() => selfDevice(devices), [devices]);
  const onTick = useCallback(() => tick(), [tick]);
  usePolling(onTick, { interval: MESH_TICK_MS, enabled: peers.length > 0, name: 'monitor:meshLiveness' });

  // A filter naming a device that left the mesh (unpaired) reads as 'all'.
  const known = filter === 'all' || devices.some((d) => d.peerId === filter);
  const toggle = useCallback(
    (peerId: string) => setFilter(filter === peerId ? 'all' : peerId),
    [filter, setFilter],
  );

  return { devices, self, peers, liveness, filter: known ? filter : 'all', setFilter, toggle };
}
