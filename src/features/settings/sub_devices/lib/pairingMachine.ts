/**
 * Pure state machine for the device-pairing ceremony.
 *
 * The backend is the authority on what is in flight: both the
 * `network:device-pairing-requested` event and `list_pending_device_pairings`
 * deliver the SAME payload — the full list of pending requests, each tagged with
 * the role this device plays. So the machine keeps that list as its source of
 * truth and layers only two local concepts on top:
 *
 *  1. `busy` — which peer the operator is currently acting on, so buttons can
 *     disable without a second round trip.
 *  2. `outcome` — the terminal result of the last action (paired / refused /
 *     cancelled), held until acknowledged so a refusal reason cannot be missed.
 *
 * Keeping this pure (no IPC, no React) is what makes the ceremony testable: the
 * event path and the poll recovery path are literally the same transition, so a
 * test proving one proves the other.
 */
import type { DevicePairingRequest } from '@/api/network/devices';
import type { PairingRefusal } from './pairingRefusal';

export type PairingAction = 'request' | 'confirm' | 'cancel';

export type PairingOutcome =
  | { kind: 'paired'; peerId: string; displayName: string }
  | { kind: 'cancelled'; peerId: string; displayName: string }
  | { kind: 'refused'; peerId: string; displayName: string; refusal: PairingRefusal };

export interface PairingState {
  /** Mirror of the backend's pending list (event push or poll recovery). */
  pending: DevicePairingRequest[];
  /** Peer currently being acted on, or null. */
  busyPeerId: string | null;
  busyAction: PairingAction | null;
  /** Terminal result awaiting operator acknowledgement. */
  outcome: PairingOutcome | null;
  /** True once the first sync landed — drives the loading-vs-empty distinction. */
  synced: boolean;
}

export type PairingEvent =
  /** Authoritative pending list from the event bridge or the recovery poll. */
  | { type: 'pending-synced'; pending: DevicePairingRequest[] }
  | { type: 'action-started'; peerId: string; action: PairingAction }
  | { type: 'request-succeeded'; request: DevicePairingRequest }
  | { type: 'confirm-succeeded'; peerId: string; displayName: string }
  | { type: 'cancel-succeeded'; peerId: string; displayName: string }
  | { type: 'action-failed'; peerId: string; displayName: string; refusal: PairingRefusal }
  | { type: 'outcome-dismissed' };

export const initialPairingState: PairingState = {
  pending: [],
  busyPeerId: null,
  busyAction: null,
  outcome: null,
  synced: false,
};

/** Clear `busy` only if it still refers to `peerId` (guards stale responses). */
function releaseBusy(state: PairingState, peerId: string): Pick<PairingState, 'busyPeerId' | 'busyAction'> {
  return state.busyPeerId === peerId
    ? { busyPeerId: null, busyAction: null }
    : { busyPeerId: state.busyPeerId, busyAction: state.busyAction };
}

function without(pending: DevicePairingRequest[], peerId: string): DevicePairingRequest[] {
  return pending.filter((p) => p.peerId !== peerId);
}

export function pairingReducer(state: PairingState, event: PairingEvent): PairingState {
  switch (event.type) {
    case 'pending-synced': {
      // The backend list is authoritative and replaces ours wholesale. If the
      // peer we were acting on has left the list, the action resolved
      // elsewhere (TTL prune, peer cancelled) — release the busy lock so the
      // UI can never wedge on a request that no longer exists.
      const stillPending = event.pending.some((p) => p.peerId === state.busyPeerId);
      return {
        ...state,
        pending: event.pending,
        synced: true,
        busyPeerId: stillPending ? state.busyPeerId : null,
        busyAction: stillPending ? state.busyAction : null,
      };
    }

    case 'action-started':
      return { ...state, busyPeerId: event.peerId, busyAction: event.action, outcome: null };

    case 'request-succeeded':
      // Show the fingerprint immediately rather than waiting for the backend's
      // own echo; the next `pending-synced` reconciles.
      return {
        ...state,
        pending: [...without(state.pending, event.request.peerId), event.request],
        ...releaseBusy(state, event.request.peerId),
      };

    case 'confirm-succeeded':
      return {
        ...state,
        pending: without(state.pending, event.peerId),
        outcome: { kind: 'paired', peerId: event.peerId, displayName: event.displayName },
        ...releaseBusy(state, event.peerId),
      };

    case 'cancel-succeeded':
      return {
        ...state,
        pending: without(state.pending, event.peerId),
        outcome: { kind: 'cancelled', peerId: event.peerId, displayName: event.displayName },
        ...releaseBusy(state, event.peerId),
      };

    case 'action-failed':
      // Deliberately does NOT touch `pending`: whether the request survives a
      // failed confirm is the backend's call, and its next sync says so.
      return {
        ...state,
        outcome: {
          kind: 'refused',
          peerId: event.peerId,
          displayName: event.displayName,
          refusal: event.refusal,
        },
        ...releaseBusy(state, event.peerId),
      };

    case 'outcome-dismissed':
      return state.outcome === null ? state : { ...state, outcome: null };

    default:
      return state;
  }
}

// -- Selectors --------------------------------------------------------------

/** The pairing this device started, if any. Only one can be shown at a time. */
export function selectOutgoing(state: PairingState): DevicePairingRequest | null {
  return state.pending.find((p) => p.role === 'initiator') ?? null;
}

/** Requests from other devices awaiting a decision here. */
export function selectIncoming(state: PairingState): DevicePairingRequest[] {
  return state.pending.filter((p) => p.role === 'responder');
}

/** True when `peerId` has an action in flight. */
export function isBusyWith(state: PairingState, peerId: string): boolean {
  return state.busyPeerId === peerId;
}

/** Peers that must not be offered a "link" button (already mid-ceremony). */
export function selectPendingPeerIds(state: PairingState): Set<string> {
  return new Set(state.pending.map((p) => p.peerId));
}
