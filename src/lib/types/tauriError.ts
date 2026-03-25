/**
 * Structured error response from Tauri IPC commands.
 *
 * The Rust backend serialises `AppError` as `{ error: string, kind: string }`.
 * This module provides the TypeScript mirror so the frontend can switch on
 * `kind` instead of regex-matching the `error` message string.
 */

/** All `kind` values the Rust `AppError` enum can produce (snake_case). */
export type TauriErrorKind =
  | 'database'
  | 'pool'
  | 'not_found'
  | 'validation'
  | 'io'
  | 'serde'
  | 'execution'
  | 'process_spawn'
  | 'auth'
  | 'network_offline'
  | 'cloud'
  | 'gitlab'
  | 'rate_limited'
  | 'forbidden'
  | 'internal';

/** Shape of the serialised `AppError` received via Tauri IPC rejection. */
export interface TauriErrorResponse {
  error: string;
  kind: TauriErrorKind;
}

/** Type guard: does the unknown rejection value look like a structured Tauri error? */
export function isTauriError(err: unknown): err is TauriErrorResponse {
  return (
    typeof err === 'object' &&
    err !== null &&
    'error' in err &&
    'kind' in err &&
    typeof (err as Record<string, unknown>).error === 'string' &&
    typeof (err as Record<string, unknown>).kind === 'string'
  );
}
