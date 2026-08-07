import { describe, it, expect } from 'vitest';
import type { DevicePairingRequest } from '@/api/network/devices';
import {
  initialPairingState,
  isBusyWith,
  pairingReducer,
  selectIncoming,
  selectOutgoing,
  selectPendingPeerIds,
  type PairingState,
} from '../pairingMachine';

function req(overrides: Partial<DevicePairingRequest> = {}): DevicePairingRequest {
  return {
    peerId: 'peer-a',
    displayName: 'Studio Mac',
    fingerprint: '042-917',
    role: 'responder',
    requestedAt: '2026-08-06T10:00:00Z',
    ...overrides,
  };
}

const refusal = { code: 'group_conflict', detail: 'different device group' } as const;

describe('pairingReducer', () => {
  it('starts empty and unsynced', () => {
    expect(initialPairingState.pending).toEqual([]);
    expect(initialPairingState.synced).toBe(false);
  });

  it('treats the event push and the poll recovery as the same transition', () => {
    const pending = [req()];
    const fromEvent = pairingReducer(initialPairingState, { type: 'pending-synced', pending });
    const fromPoll = pairingReducer(initialPairingState, { type: 'pending-synced', pending });
    expect(fromEvent).toEqual(fromPoll);
    expect(fromEvent.synced).toBe(true);
    expect(fromEvent.pending).toEqual(pending);
  });

  it('marks a peer busy while an action is in flight', () => {
    const s = pairingReducer(initialPairingState, {
      type: 'action-started',
      peerId: 'peer-a',
      action: 'confirm',
    });
    expect(isBusyWith(s, 'peer-a')).toBe(true);
    expect(isBusyWith(s, 'peer-b')).toBe(false);
    expect(s.busyAction).toBe('confirm');
  });

  it('shows the initiator fingerprint as soon as the request succeeds', () => {
    let s = pairingReducer(initialPairingState, {
      type: 'action-started',
      peerId: 'peer-a',
      action: 'request',
    });
    s = pairingReducer(s, { type: 'request-succeeded', request: req({ role: 'initiator' }) });
    expect(selectOutgoing(s)?.fingerprint).toBe('042-917');
    expect(s.busyPeerId).toBeNull();
  });

  it('does not duplicate a peer when the request echoes back in a sync', () => {
    const request = req({ role: 'initiator' });
    let s = pairingReducer(initialPairingState, { type: 'request-succeeded', request });
    s = pairingReducer(s, { type: 'request-succeeded', request });
    expect(s.pending).toHaveLength(1);
  });

  it('records a paired outcome and drops the request on confirm', () => {
    let s = pairingReducer(initialPairingState, { type: 'pending-synced', pending: [req()] });
    s = pairingReducer(s, { type: 'action-started', peerId: 'peer-a', action: 'confirm' });
    s = pairingReducer(s, { type: 'confirm-succeeded', peerId: 'peer-a', displayName: 'Studio Mac' });
    expect(s.pending).toEqual([]);
    expect(s.outcome).toEqual({ kind: 'paired', peerId: 'peer-a', displayName: 'Studio Mac' });
    expect(s.busyPeerId).toBeNull();
  });

  it('records a cancelled outcome from either side', () => {
    let s = pairingReducer(initialPairingState, { type: 'pending-synced', pending: [req()] });
    s = pairingReducer(s, { type: 'cancel-succeeded', peerId: 'peer-a', displayName: 'Studio Mac' });
    expect(s.pending).toEqual([]);
    expect(s.outcome?.kind).toBe('cancelled');
  });

  it('surfaces a typed refusal without discarding backend-owned pending state', () => {
    let s = pairingReducer(initialPairingState, { type: 'pending-synced', pending: [req()] });
    s = pairingReducer(s, { type: 'action-started', peerId: 'peer-a', action: 'confirm' });
    s = pairingReducer(s, {
      type: 'action-failed',
      peerId: 'peer-a',
      displayName: 'Studio Mac',
      refusal,
    });
    expect(s.outcome).toEqual({
      kind: 'refused',
      peerId: 'peer-a',
      displayName: 'Studio Mac',
      refusal,
    });
    // The backend decides whether the request survives a failed confirm.
    expect(s.pending).toHaveLength(1);
    expect(s.busyPeerId).toBeNull();
  });

  it('releases a busy lock when the peer disappears from the backend list', () => {
    let s = pairingReducer(initialPairingState, { type: 'pending-synced', pending: [req()] });
    s = pairingReducer(s, { type: 'action-started', peerId: 'peer-a', action: 'confirm' });
    // Peer cancelled from its side / the TTL pruned the entry.
    s = pairingReducer(s, { type: 'pending-synced', pending: [] });
    expect(s.busyPeerId).toBeNull();
    expect(s.busyAction).toBeNull();
  });

  it('keeps the busy lock while the peer is still pending', () => {
    let s = pairingReducer(initialPairingState, { type: 'action-started', peerId: 'peer-a', action: 'confirm' });
    s = pairingReducer(s, { type: 'pending-synced', pending: [req()] });
    expect(s.busyPeerId).toBe('peer-a');
  });

  it('ignores a stale response for a peer that is no longer the busy one', () => {
    let s = pairingReducer(initialPairingState, { type: 'action-started', peerId: 'peer-b', action: 'request' });
    s = pairingReducer(s, { type: 'confirm-succeeded', peerId: 'peer-a', displayName: 'Old' });
    expect(s.busyPeerId).toBe('peer-b');
  });

  it('clears an outcome once acknowledged, and is a no-op when there is none', () => {
    const s: PairingState = {
      ...initialPairingState,
      outcome: { kind: 'paired', peerId: 'peer-a', displayName: 'Studio Mac' },
    };
    expect(pairingReducer(s, { type: 'outcome-dismissed' }).outcome).toBeNull();
    const empty = pairingReducer(initialPairingState, { type: 'outcome-dismissed' });
    expect(empty).toBe(initialPairingState);
  });

  it('starting a new action clears the previous outcome', () => {
    let s = pairingReducer(initialPairingState, {
      type: 'action-failed',
      peerId: 'peer-a',
      displayName: 'Studio Mac',
      refusal,
    });
    s = pairingReducer(s, { type: 'action-started', peerId: 'peer-b', action: 'request' });
    expect(s.outcome).toBeNull();
  });
});

describe('selectors', () => {
  const state = pairingReducer(initialPairingState, {
    type: 'pending-synced',
    pending: [
      req({ peerId: 'peer-a', role: 'responder' }),
      req({ peerId: 'peer-b', role: 'initiator' }),
      req({ peerId: 'peer-c', role: 'responder' }),
    ],
  });

  it('splits pending requests by the role this device plays', () => {
    expect(selectOutgoing(state)?.peerId).toBe('peer-b');
    expect(selectIncoming(state).map((r) => r.peerId)).toEqual(['peer-a', 'peer-c']);
  });

  it('lists every peer mid-ceremony so they are not offered a link button', () => {
    expect(selectPendingPeerIds(state)).toEqual(new Set(['peer-a', 'peer-b', 'peer-c']));
  });

  it('returns null when nothing was initiated here', () => {
    const incomingOnly = pairingReducer(initialPairingState, {
      type: 'pending-synced',
      pending: [req()],
    });
    expect(selectOutgoing(incomingOnly)).toBeNull();
  });
});
