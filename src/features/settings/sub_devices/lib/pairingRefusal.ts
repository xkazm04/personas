/**
 * Turns a pairing IPC rejection into a typed, operator-facing refusal.
 *
 * The backend refuses pairings for a handful of *specific, actionable* reasons
 * (see `src-tauri/engine/src/p2p/device_pairing.rs`). Collapsing all of them
 * into "Pairing failed: <raw string>" strands the operator, because most of them
 * have a concrete fix — reconnect the peer, unpair a device on the other side,
 * confirm on the other screen. So each known refusal gets a stable code, and the
 * UI renders a localized title + fix hint per code.
 *
 * `AppError` carries only `{ error, kind }` over IPC, so the reason has to be
 * recovered from the message. Every marker below is anchored on a distinctive
 * phrase from the Rust source rather than a generic word, and anything
 * unrecognised falls through to `unknown` — which shows the backend's own
 * message verbatim instead of inventing one.
 */
import { isTauriError } from '@/lib/types/tauriError';
import { isP2pRuntimeError } from '@/lib/network/p2pCapability';

export type PairingRefusalCode =
  /** Both devices already belong to populated but different device groups. */
  | 'group_conflict'
  /** No authenticated connection to the peer (pairing sits on top of the handshake). */
  | 'not_connected'
  /** Tried to pair the local device with itself. */
  | 'self_pair'
  /** The other side said no. */
  | 'declined'
  /** Responder is already holding the maximum number of pending requests. */
  | 'too_many_pending'
  /** The request expired or the receipt never arrived. */
  | 'timed_out'
  /** The pairing is no longer in flight (expired TTL, already cancelled). */
  | 'no_longer_pending'
  /** Confirm was attempted on the initiating device. */
  | 'wrong_side'
  /** The session is locked / IPC auth rejected the call. */
  | 'unauthorized'
  /** This build has no `p2p` feature. */
  | 'unavailable'
  /** Unrecognised — render `detail` verbatim. */
  | 'unknown';

export interface PairingRefusal {
  code: PairingRefusalCode;
  /** The backend's own message, kept for `unknown` and for diagnostics. */
  detail: string;
}

/**
 * Message markers, used only for refusals the backend has NOT given a dedicated
 * `AppError` variant. Ordered — first match wins, specific patterns first.
 */
const MARKERS: ReadonlyArray<readonly [PairingRefusalCode, RegExp]> = [
  ['self_pair', /pair a device with itself|its own remote device/i],
  ['not_connected', /requires an authenticated connection|not connected to peer/i],
  ['declined', /declined the pairing/i],
  ['too_many_pending', /too many pending pairing/i],
  ['wrong_side', /only the receiving device can confirm|did not initiate/i],
  ['timed_out', /timed out/i],
  [
    'group_conflict',
    /(different|another|conflicting|separate)\s+(device\s+)?group|device group[^.]{0,60}(conflict|differ)|already belongs? to (a )?different/i,
  ],
  ['no_longer_pending', /no pairing (request pending|in progress)/i],
];

/**
 * Classify a rejection thrown by `pair_request` / `pair_confirm` / `pair_cancel`.
 */
export function classifyPairingRefusal(err: unknown): PairingRefusal {
  if (!isP2pRuntimeError(err)) {
    return { code: 'unavailable', detail: toDetail(err) };
  }

  const detail = toDetail(err);

  // The backend gives the most important refusal its own AppError variant, so
  // classify it structurally and never on message text.
  if (isTauriError(err) && err.kind === 'device_group_conflict') {
    return { code: 'group_conflict', detail };
  }

  if (isTauriError(err) && err.kind === 'auth') {
    return { code: 'unauthorized', detail };
  }

  for (const [code, marker] of MARKERS) {
    if (marker.test(detail)) return { code, detail };
  }

  if (isTauriError(err) && err.kind === 'not_found') {
    return { code: 'no_longer_pending', detail };
  }

  return { code: 'unknown', detail };
}

function toDetail(err: unknown): string {
  if (isTauriError(err)) return err.error;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}
