/**
 * How reachable a paired PC is right now, in the words the "Your PCs" page
 * uses. Derived from the discovered-peer list exactly as the retired paired
 * table did: connected = online, seen on the LAN but not connected = on this
 * network, absent = not seen lately.
 */
import type { DiscoveredPeer } from '@/api/network/discovery';
import type { Tone } from '@/features/shared/components/kit';

export type Reachability = 'online' | 'on_network' | 'not_seen';

export function reachabilityOf(peerId: string, peers: readonly DiscoveredPeer[]): Reachability {
  const peer = peers.find((p) => p.peer_id === peerId);
  if (!peer) return 'not_seen';
  return peer.is_connected ? 'online' : 'on_network';
}

/** The kit tone a reachability mark is drawn in. */
export const REACHABILITY_TONE: Record<Reachability, Tone> = {
  online: 'success',
  on_network: 'info',
  not_seen: 'neutral',
};

/** The `t.sharing` key that names each state. */
export const REACHABILITY_KEY = {
  online: 'reach_online',
  on_network: 'reach_on_network',
  not_seen: 'reach_not_seen',
} as const satisfies Record<Reachability, string>;
