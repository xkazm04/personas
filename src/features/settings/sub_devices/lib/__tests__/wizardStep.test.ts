// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DevicePairingRequest } from '@/api/network/devices';
import { initialPairingState, pairingReducer, type PairingEvent, type PairingState } from '../pairingMachine';
import { initiatorVerdict, isMidFlow, wizardStep, type WizardView } from '../wizardStep';

function req(overrides: Partial<DevicePairingRequest> = {}): DevicePairingRequest {
  return {
    peerId: 'peer-a',
    displayName: 'Studio Mac',
    fingerprint: '042-917',
    role: 'initiator',
    requestedAt: '2026-11-05T10:00:00Z',
    ...overrides,
  };
}

function run(events: PairingEvent[], from: PairingState = initialPairingState): PairingState {
  return events.reduce(pairingReducer, from);
}

function viewOf(state: PairingState, owned: string[] = []): WizardView {
  return wizardStep({
    pending: state.pending,
    ownedPeerIds: new Set(owned),
    chosen: state.chosen,
    outcome: state.outcome,
  });
}

/** The initiator path up to the point where the other PC has acted. */
const initiatorWaiting: PairingEvent[] = [
  { type: 'peer-chosen', peerId: 'peer-a', displayName: 'Studio Mac' },
  { type: 'action-started', peerId: 'peer-a', action: 'request' },
  { type: 'request-succeeded', request: req() },
];

describe('wizardStep - initiator', () => {
  it('starts on find with nothing in flight', () => {
    expect(viewOf(initialPairingState).step).toBe('find');
  });

  it('stays on find while the request is being sent', () => {
    const s = run(initiatorWaiting.slice(0, 2));
    expect(viewOf(s)).toEqual({ step: 'find', path: 'initiator' });
  });

  it('moves to code with the fingerprint once the request answered', () => {
    const v = viewOf(run(initiatorWaiting));
    expect(v.step).toBe('code');
    expect(v.step === 'code' && v.request?.fingerprint).toBe('042-917');
  });

  it('reaches code from the echo alone, before pair_request answered', () => {
    const s = run([
      ...initiatorWaiting.slice(0, 2),
      { type: 'pending-synced', pending: [req()] },
    ]);
    expect(viewOf(s).step).toBe('code');
  });

  it('a sync without the entry BEFORE the request answered does not settle it', () => {
    const s = run([...initiatorWaiting.slice(0, 2), { type: 'pending-synced', pending: [] }]);
    expect(s.chosen?.phase).toBe('requesting');
    expect(viewOf(s).step).toBe('find');
  });

  it('keeps showing the code while the vanished request is being settled', () => {
    const s = run([...initiatorWaiting, { type: 'pending-synced', pending: [] }]);
    expect(s.chosen?.phase).toBe('settling');
    const v = viewOf(s);
    expect(v.step).toBe('code');
    expect(v.step === 'code' && v.request?.fingerprint).toBe('042-917');
  });

  it('derives PAIRED when the refetched owned list holds the peer', () => {
    const s = run([...initiatorWaiting, { type: 'pending-synced', pending: [] }, { type: 'owned-refetched' }]);
    expect(viewOf(s, ['peer-a'])).toEqual({
      step: 'done',
      path: 'initiator',
      kind: 'paired',
      displayName: 'Studio Mac',
    });
  });

  it('derives DECLINED when the refetched owned list lacks the peer (declined or ran out)', () => {
    const s = run([...initiatorWaiting, { type: 'pending-synced', pending: [] }, { type: 'owned-refetched' }]);
    expect(viewOf(s, ['someone-else'])).toMatchObject({ step: 'done', kind: 'declined' });
  });

  it('ignores an owned refetch that nobody was waiting on', () => {
    const s = run([...initiatorWaiting, { type: 'owned-refetched' }]);
    expect(s.chosen?.phase).toBe('waiting');
  });

  it('cancel from code goes back to find', () => {
    const s = run([...initiatorWaiting, { type: 'cancel-succeeded', peerId: 'peer-a', displayName: 'Studio Mac' }]);
    expect(s.chosen).toBeNull();
    expect(viewOf(s).step).toBe('find');
  });

  it('a refused request drops the choice so the refusal shows on find', () => {
    const s = run([
      ...initiatorWaiting.slice(0, 2),
      {
        type: 'action-failed',
        peerId: 'peer-a',
        displayName: 'Studio Mac',
        refusal: { code: 'not_connected', detail: '' },
      },
    ]);
    expect(s.chosen).toBeNull();
    expect(s.outcome?.kind).toBe('refused');
    expect(viewOf(s).step).toBe('find');
  });

  it('dismissing the result returns to find', () => {
    const s = run([
      ...initiatorWaiting,
      { type: 'pending-synced', pending: [] },
      { type: 'owned-refetched' },
      { type: 'outcome-dismissed' },
    ]);
    expect(viewOf(s, ['peer-a']).step).toBe('find');
  });

  it('initiatorVerdict reads the owned list only', () => {
    expect(initiatorVerdict('p', new Set(['p']))).toBe('paired');
    expect(initiatorVerdict('p', new Set())).toBe('declined');
  });
});

describe('wizardStep - responder', () => {
  const incoming = req({ peerId: 'peer-b', displayName: 'Laptop', role: 'responder' });
  const asked = run([{ type: 'pending-synced', pending: [incoming] }]);

  it('lands on approve when another PC asked', () => {
    expect(viewOf(asked)).toEqual({ step: 'approve', path: 'responder', request: incoming });
  });

  it('stays on approve after a wrong code with tries left', () => {
    const s = run(
      [{ type: 'code-mismatch', peerId: 'peer-b', displayName: 'Laptop', attemptsLeft: 3, withdrawn: false }],
      asked,
    );
    expect(s.mismatch).toEqual({ peerId: 'peer-b', attemptsLeft: 3 });
    expect(viewOf(s).step).toBe('approve');
  });

  it('goes to done(wrongCode) when the request was withdrawn after too many misses', () => {
    const s = run(
      [{ type: 'code-mismatch', peerId: 'peer-b', displayName: 'Laptop', attemptsLeft: 0, withdrawn: true }],
      asked,
    );
    expect(s.pending).toEqual([]);
    expect(viewOf(s)).toEqual({ step: 'done', path: 'responder', kind: 'wrongCode', displayName: 'Laptop' });
  });

  it('goes to done(declined) when nothing was pending any more', () => {
    const s = run([{ type: 'code-no-pending', peerId: 'peer-b', displayName: 'Laptop' }], asked);
    expect(viewOf(s)).toMatchObject({ step: 'done', path: 'responder', kind: 'declined' });
  });

  it('goes to done(paired) on a matching code', () => {
    const s = run(
      [
        { type: 'action-started', peerId: 'peer-b', action: 'confirm' },
        { type: 'confirm-succeeded', peerId: 'peer-b', displayName: 'Laptop' },
      ],
      asked,
    );
    expect(viewOf(s)).toMatchObject({ step: 'done', path: 'responder', kind: 'paired' });
    expect(s.mismatch).toBeNull();
  });

  it('decline leaves nothing to show', () => {
    const s = run([{ type: 'cancel-succeeded', peerId: 'peer-b', displayName: 'Laptop' }], asked);
    expect(viewOf(s).step).toBe('find');
  });
});

describe('isMidFlow', () => {
  it('asks before closing only on code and approve', () => {
    expect(isMidFlow({ step: 'find', path: 'initiator' })).toBe(false);
    expect(isMidFlow({ step: 'code', path: 'initiator', request: null, displayName: 'x' })).toBe(true);
    expect(isMidFlow({ step: 'approve', path: 'responder', request: req() })).toBe(true);
    expect(isMidFlow({ step: 'done', path: 'responder', kind: 'paired', displayName: 'x' })).toBe(false);
  });
});
