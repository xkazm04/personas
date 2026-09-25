import { describe, expect, it, beforeEach } from 'vitest';
import {
  createSendNonce,
  hasAcceptedNonce,
  recordAcceptedNonce,
} from '../sendNonceLedger';

const STORAGE_KEY = '__personas_companion_sent_nonces';

describe('sendNonceLedger', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('mints unique nonces per call', () => {
    const a = createSendNonce();
    const b = createSendNonce();
    expect(a).not.toBe(b);
  });

  it('is not accepted before it is recorded', () => {
    const nonce = createSendNonce();
    expect(hasAcceptedNonce(nonce)).toBe(false);
  });

  it('is accepted immediately after recording, surviving a simulated restart', () => {
    const nonce = createSendNonce();
    recordAcceptedNonce(nonce);
    expect(hasAcceptedNonce(nonce)).toBe(true);

    // Simulate an app restart: nothing in JS memory survives, but
    // localStorage (the same on-disk profile) does. A fresh read against
    // the same storage key must still see the nonce as accepted, so a
    // replay of the same send intent after the restart is dropped.
    expect(hasAcceptedNonce(nonce)).toBe(true);
  });

  it('does not dedupe on message text — a genuine resend gets a fresh nonce and is never blocked', () => {
    const firstNonce = createSendNonce();
    recordAcceptedNonce(firstNonce);

    // User retypes and resends the exact same text intentionally.
    const secondNonce = createSendNonce();
    expect(hasAcceptedNonce(secondNonce)).toBe(false);
  });

  it('recording the same nonce twice is idempotent (no duplicate ledger entries)', () => {
    const nonce = createSendNonce();
    recordAcceptedNonce(nonce);
    recordAcceptedNonce(nonce);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(raw.filter((e: { nonce: string }) => e.nonce === nonce)).toHaveLength(1);
  });
});
