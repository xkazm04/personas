/**
 * The one field of a failed key-store call that is safe to log.
 *
 * Backend IPC errors can carry the rejected payload (the secret) in their
 * message, so the key manager never logs a message. What it can log is the
 * error's CLASS. `invokeWithTimeout` rejects with a serialized AppError OBJECT
 * (`{ error, kind, category, ... }`), never an `Error`, so reading only
 * `err.name` collapsed every backend failure to the word "object" and the log
 * could not tell a validation refusal from a keyring outage.
 *
 * `kind` is the AppError variant name (a closed set chosen in Rust), and it is
 * accepted only when it is a bare identifier, so free text can never ride in
 * through it.
 */
const KIND_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function secretSafeErrorCode(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (err !== null && typeof err === 'object') {
    const kind = (err as { kind?: unknown }).kind;
    if (typeof kind === 'string' && KIND_SHAPE.test(kind)) return kind;
  }
  return typeof err;
}
