// useDeviceName — a paired device's display name, for the "from <device>" read
// on a LOCAL session tile that a paired device dispatched here.
//
// Resolved from the paired-devices list (`ownedDevices`, the Devices slice),
// then the dispatch targets, then a short peer id: a name is a nicety, and a
// tile must never go blank because the list has not loaded. A tile that needs
// a name while the list is empty asks for it once per mount; the slice's own
// loading flag folds a board of such tiles into one read. Nothing polls.

import { useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';

/** Pure half, for tests: the name to show for `peerId`, never empty. */
export function resolveDeviceName(
  peerId: string,
  owned: ReadonlyArray<{ peerId: string; displayName: string }>,
  targets: ReadonlyArray<{ peerId: string; displayName: string }>,
): string {
  const hit = owned.find((d) => d.peerId === peerId) ?? targets.find((d) => d.peerId === peerId);
  return hit?.displayName?.trim() || peerId.slice(0, 8);
}

export function useDeviceName(peerId: string | null): string | null {
  const name = useSystemStore((s) => (peerId ? resolveDeviceName(peerId, s.ownedDevices, s.dispatchDevices) : null));
  const known = useSystemStore((s) => s.ownedDevices.length > 0);
  const loading = useSystemStore((s) => s.ownedDevicesLoading);
  const fetchOwned = useSystemStore((s) => s.fetchOwnedDevices);
  const asked = useRef(false);
  useEffect(() => {
    if (!peerId || known || loading || asked.current) return;
    asked.current = true;
    void fetchOwned();
  }, [peerId, known, loading, fetchOwned]);
  return name;
}
