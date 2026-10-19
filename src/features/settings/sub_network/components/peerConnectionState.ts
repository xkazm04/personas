import type { ConnectionState, DiscoveredPeer } from '@/api/network/discovery';

/**
 * The connection state a peer row shows: the live snapshot decides, the
 * store's per-peer entry only adds what the snapshot cannot carry.
 *
 * `connectionStates` is written by connect/disconnect actions and never by the
 * snapshot poll, so it goes stale the moment the link changes on its own: a
 * peer that dropped kept reading "Connected" with a Disconnect button, and a
 * peer whose one connect attempt failed kept reading "Failed" after it linked
 * up inbound. Only `Connecting` (an attempt in flight) outranks the snapshot;
 * `Failed` is shown only while the snapshot agrees the peer is not connected.
 */
export function resolvePeerConnectionState(
  peer: Pick<DiscoveredPeer, 'is_connected'>,
  recorded?: ConnectionState,
): ConnectionState {
  if (recorded === 'Connecting') return 'Connecting';
  if (peer.is_connected) return 'Connected';
  if (recorded === 'Failed') return 'Failed';
  return 'Disconnected';
}
