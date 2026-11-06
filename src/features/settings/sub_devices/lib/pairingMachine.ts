/**
 * Pure state machine for the device-pairing ceremony.
 *
 * The backend is the authority on what is in flight: both the
 * `network:device-pairing-requested` event and `list_pending_device_pairings`
 * deliver the SAME payload — the full list of pending requests, each tagged with
 * the role this device plays. So the machine keeps that list as its source of
 * truth and layers only local concepts on top:
 *
 *  1. `busy` — which peer the operator is currently acting on, so buttons can
 *     disable without a second round trip.
 *  2. `outcome` — the terminal result of the last action (paired / refused /
 *     cancelled / declined / wrongCode), held until acknowledged so a refusal
 *     reason cannot be missed.
 *  3. `chosen` — the PC this device asked to pair with. Its `phase` is how the
 *     initiator learns the result: the backend tells it nothing directly, its
 *     pending entry just disappears (`settling`), the owned list is refetched,
 *     and once that landed (`settled`) `wizardStep` reads paired vs declined
 *     off the owned list.
 *  4. `mismatch` — the last wrong typed code on the receiving side.
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
  | { kind: 'refused'; peerId: string; displayName: string; refusal: PairingRefusal }
  /** The request is gone without a pairing (the other side declined, or it ran out). */
  | { kind: 'declined'; peerId: string; displayName: string }
  /** The receiving side typed the wrong code too often and the request was withdrawn. */
  | { kind: 'wrongCode'; peerId: string; displayName: string };

/**
 * `requesting` until the backend answered `pair_request`, `waiting` while the
 * entry is pending, `settling` once it vanished (owned list being refetched),
 * `settled` once that refetch landed.
 */
export type ChosenPhase = 'requesting' | 'waiting' | 'settling' | 'settled';

export interface ChosenPeer {
  peerId: string;
  displayName: string;
  /** The initiator entry, kept after it leaves `pending` so the code stays on screen while settling. */
  request: DevicePairingRequest | null;
  phase: ChosenPhase;
}

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
  /** The PC this device asked to pair with, while the wizard follows it. */
  chosen: ChosenPeer | null;
  /** The last wrong typed code on the receiving side. */
  mismatch: { peerId: string; attemptsLeft: number } | null;
}

export type PairingEvent =
  /** Authoritative pending list from the event bridge or the recovery poll. */
  | { type: 'pending-synced'; pending: DevicePairingRequest[] }
  | { type: 'action-started'; peerId: string; action: PairingAction }
  | { type: 'request-succeeded'; request: DevicePairingRequest }
  | { type: 'confirm-succeeded'; peerId: string; displayName: string }
  | { type: 'cancel-succeeded'; peerId: string; displayName: string }
  | { type: 'action-failed'; peerId: string; displayName: string; refusal: PairingRefusal }
  /** The operator picked a PC to pair with (dispatched before `action-started`). */
  | { type: 'peer-chosen'; peerId: string; displayName: string }
  /** The owned-device refetch a `settling` choice asked for has landed. */
  | { type: 'owned-refetched' }
  /** `pair_confirm_code` said the typed code was wrong. */
  | { type: 'code-mismatch'; peerId: string; displayName: string; attemptsLeft: number; withdrawn: boolean }
  /** `pair_confirm_code` found nothing pending: it was declined or ran out. */
  | { type: 'code-no-pending'; peerId: string; displayName: string }
  | { type: 'outcome-dismissed' };

export const initialPairingState: PairingState = {
  pending: [],
  busyPeerId: null,
  busyAction: null,
  outcome: null,
  synced: false,
  chosen: null,
  mismatch: null,
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

/** Follow the chosen peer through a fresh pending list. */
function trackChosen(chosen: ChosenPeer | null, pending: DevicePairingRequest[]): ChosenPeer | null {
  if (!chosen) return null;
  const entry = pending.find((p) => p.peerId === chosen.peerId && p.role === 'initiator');
  if (entry) {
    return chosen.phase === 'requesting' || chosen.phase === 'waiting'
      ? { ...chosen, request: entry, phase: 'waiting' }
      : chosen;
  }
  // Only a request that WAS pending can resolve by vanishing; a sync landing
  // before `pair_request` answered says nothing about it yet.
  return chosen.phase === 'waiting' ? { ...chosen, phase: 'settling' } : chosen;
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
        chosen: trackChosen(state.chosen, event.pending),
      };
    }

    case 'action-started':
      return { ...state, busyPeerId: event.peerId, busyAction: event.action, outcome: null };

    case 'peer-chosen':
      return {
        ...state,
        chosen: { peerId: event.peerId, displayName: event.displayName, request: null, phase: 'requesting' },
      };

    case 'request-succeeded': {
      // Show the fingerprint immediately rather than waiting for the backend's
      // own echo; the next `pending-synced` reconciles.
      const pending = [...without(state.pending, event.request.peerId), event.request];
      return {
        ...state,
        pending,
        chosen: trackChosen(state.chosen, pending),
        ...releaseBusy(state, event.request.peerId),
      };
    }

    case 'owned-refetched':
      return state.chosen?.phase === 'settling'
        ? { ...state, chosen: { ...state.chosen, phase: 'settled' } }
        : state;

    case 'confirm-succeeded':
      return {
        ...state,
        pending: without(state.pending, event.peerId),
        mismatch: null,
        outcome: { kind: 'paired', peerId: event.peerId, displayName: event.displayName },
        ...releaseBusy(state, event.peerId),
      };

    case 'code-mismatch':
      return event.withdrawn
        ? {
            ...state,
            pending: without(state.pending, event.peerId),
            mismatch: null,
            outcome: { kind: 'wrongCode', peerId: event.peerId, displayName: event.displayName },
            ...releaseBusy(state, event.peerId),
          }
        : {
            ...state,
            mismatch: { peerId: event.peerId, attemptsLeft: event.attemptsLeft },
            ...releaseBusy(state, event.peerId),
          };

    case 'code-no-pending':
      return {
        ...state,
        pending: without(state.pending, event.peerId),
        mismatch: null,
        outcome: { kind: 'declined', peerId: event.peerId, displayName: event.displayName },
        ...releaseBusy(state, event.peerId),
      };

    case 'cancel-succeeded':
      return {
        ...state,
        pending: without(state.pending, event.peerId),
        outcome: { kind: 'cancelled', peerId: event.peerId, displayName: event.displayName },
        chosen: state.chosen?.peerId === event.peerId ? null : state.chosen,
        mismatch: state.mismatch?.peerId === event.peerId ? null : state.mismatch,
        ...releaseBusy(state, event.peerId),
      };

    case 'action-failed': {
      // Deliberately does NOT touch `pending`: whether the request survives a
      // failed confirm is the backend's call, and its next sync says so. A
      // failed REQUEST drops the choice, so the wizard is back on Find with the
      // refusal beside the list it came from.
      const requestFailed =
        state.busyAction === 'request' && state.busyPeerId === event.peerId && state.chosen?.peerId === event.peerId;
      return {
        ...state,
        chosen: requestFailed ? null : state.chosen,
        outcome: {
          kind: 'refused',
          peerId: event.peerId,
          displayName: event.displayName,
          refusal: event.refusal,
        },
        ...releaseBusy(state, event.peerId),
      };
    }

    case 'outcome-dismissed':
      // Dismissing ends the wizard's run: the result, the choice it followed
      // and any stale mismatch go together.
      return state.outcome === null && state.chosen === null && state.mismatch === null
        ? state
        : { ...state, outcome: null, chosen: null, mismatch: null };

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
