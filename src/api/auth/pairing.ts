import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { PendingPairingView } from "@/lib/bindings/PendingPairingView";

export type { PendingPairingView };

/** Pending cloud-app pairings awaiting the user's approval (Direction 1). */
export const listPendingPairings = () =>
  invoke<PendingPairingView[]>("list_pending_pairings");

/**
 * Approve a pending pairing — mints an origin-bound, scoped, expiring key for the
 * requesting cloud origin and makes it claimable. `scopes` are the (possibly
 * narrowed) scopes the user granted; `expiresInDays` is 7/30/90 (paired keys
 * always expire).
 */
export const approvePairing = (nonce: string, scopes: string[], expiresInDays: number) =>
  invoke<void>("approve_pairing", { nonce, scopes, expiresInDays });

export const rejectPairing = (nonce: string) =>
  invoke<void>("reject_pairing", { nonce });

/** Revoke a paired key by id (drops its origin from the CORS allowlist). */
export const revokePairing = (keyId: string) =>
  invoke<void>("revoke_pairing", { keyId });
