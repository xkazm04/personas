import { describe, it, expect } from 'vitest';
import { classifyPairingRefusal } from '../pairingRefusal';

/** Shape the Rust `AppError` serialises to over IPC. */
function appError(error: string, kind = 'validation') {
  return { error, kind, category: 'user_error' };
}

describe('classifyPairingRefusal', () => {
  it('names the device-group conflict, the one refusal with a real fix', () => {
    const r = classifyPairingRefusal(
      appError('This device already has owned devices in a different group'),
    );
    expect(r.code).toBe('group_conflict');
  });

  it('recognises other phrasings of the same group conflict', () => {
    for (const message of [
      'Cannot pair: the device groups differ between these machines',
      'That device already belongs to a different device group',
      'Refused: conflicting device group',
    ]) {
      expect(classifyPairingRefusal(appError(message)).code).toBe('group_conflict');
    }
  });

  it('recognises a missing authenticated connection', () => {
    expect(
      classifyPairingRefusal(
        appError('Not connected to peer abc; pairing requires an authenticated connection'),
      ).code,
    ).toBe('not_connected');
  });

  it('recognises self-pairing', () => {
    expect(classifyPairingRefusal(appError('Cannot pair a device with itself')).code).toBe('self_pair');
    expect(
      classifyPairingRefusal(appError('Cannot register this device as its own remote device')).code,
    ).toBe('self_pair');
  });

  it('recognises an explicit decline', () => {
    expect(classifyPairingRefusal(appError('Peer declined the pairing request')).code).toBe('declined');
  });

  it('recognises the responder anti-spam cap', () => {
    expect(classifyPairingRefusal(appError('Too many pending pairing requests')).code).toBe(
      'too_many_pending',
    );
  });

  it('recognises a confirm attempted on the wrong side', () => {
    expect(
      classifyPairingRefusal(appError('Only the receiving device can confirm a pairing')).code,
    ).toBe('wrong_side');
  });

  it('recognises an expired request', () => {
    expect(
      classifyPairingRefusal(appError('Pairing request timed out awaiting receipt', 'internal')).code,
    ).toBe('timed_out');
  });

  it('recognises a pairing that is no longer in flight', () => {
    expect(
      classifyPairingRefusal(appError('No pairing request pending from abc', 'not_found')).code,
    ).toBe('no_longer_pending');
    expect(classifyPairingRefusal(appError('No pairing in progress with abc')).code).toBe(
      'no_longer_pending',
    );
  });

  it('falls back to not_found for unrecognised not_found errors', () => {
    expect(classifyPairingRefusal(appError('Something vanished', 'not_found')).code).toBe(
      'no_longer_pending',
    );
  });

  it('routes auth failures to the unlock hint', () => {
    expect(classifyPairingRefusal(appError('Session token invalid', 'auth')).code).toBe('unauthorized');
  });

  it('classifies an unstructured rejection as a missing feature, not a refusal', () => {
    // Tauri rejects an unregistered command with a bare string, which is how a
    // lite build (no `p2p`) presents. Never a "pairing failed" story.
    expect(classifyPairingRefusal('Command pair_request not found').code).toBe('unavailable');
  });

  it('keeps the backend message verbatim when it cannot classify', () => {
    const r = classifyPairingRefusal(appError('Some brand new backend refusal'));
    expect(r.code).toBe('unknown');
    expect(r.detail).toBe('Some brand new backend refusal');
  });
});
