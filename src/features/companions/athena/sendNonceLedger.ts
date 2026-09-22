/**
 * Idempotency ledger for outbound companion chat turns.
 *
 * The in-flight re-entrancy guard in `CompanionPanel.send` (`sendingRef`) is
 * a React ref — it protects against two rapid clicks in the SAME session,
 * but it's gone the instant the process restarts. If a turn is mid-flight
 * when the app restarts and whatever triggered the send (composer submit,
 * an autoSend `pendingPrompt`, a queued message) is replayed with the same
 * client-generated nonce, this ledger — backed by localStorage, which
 * survives a restart — is what stops it from dispatching twice.
 *
 * Dedup is on the nonce, NEVER on message text: a user who retypes and
 * resends the exact same words gets a fresh nonce each time and always
 * goes through.
 */

import { silentCatch } from '@/lib/silentCatch';

const STORAGE_KEY = '__personas_companion_sent_nonces';
const MAX_ENTRIES = 200;
const TTL_MS = 24 * 60 * 60 * 1000;

interface NonceEntry {
  nonce: string;
  acceptedAt: number;
}

function readLedger(): NonceEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is NonceEntry =>
        !!e && typeof e === 'object' && typeof (e as NonceEntry).nonce === 'string',
    );
  } catch {
    return [];
  }
}

function writeLedger(entries: NonceEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    // Best-effort — a full/unavailable localStorage just means restart
    // survival is lost for this send; the in-memory sendingRef guard
    // still covers the same-session case.
    silentCatch('sendNonceLedger:writeLedger')(err);
  }
}

/** A fresh, unguessable idempotency key for one send intent. */
export function createSendNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** True when this nonce has already been accepted for dispatch (this session or a prior one). */
export function hasAcceptedNonce(nonce: string): boolean {
  const now = Date.now();
  return readLedger().some((e) => e.nonce === nonce && now - e.acceptedAt < TTL_MS);
}

/**
 * Record a nonce as accepted for dispatch. Call this synchronously BEFORE
 * the IPC round-trip so the record survives a restart that happens mid-turn.
 */
export function recordAcceptedNonce(nonce: string): void {
  const now = Date.now();
  const entries = readLedger().filter((e) => now - e.acceptedAt < TTL_MS);
  if (entries.some((e) => e.nonce === nonce)) return;
  entries.unshift({ nonce, acceptedAt: now });
  writeLedger(entries.slice(0, MAX_ENTRIES));
}
