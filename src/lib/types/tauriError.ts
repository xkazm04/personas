/**
 * Structured error response from Tauri IPC commands.
 *
 * The Rust backend serialises `AppError` as
 * `{ error, kind, category, auto_fixable, failover_eligible }` (plus an
 * optional `details` object for `authorization_required`). This module
 * provides the TypeScript mirror so the frontend can switch on the structured
 * `category` / `kind` instead of regex-matching the `error` message string.
 *
 * `category` and the two booleans are computed backend-side by the canonical
 * `error_taxonomy` (Rust `AppError::category()` → `ErrorCategory`), so the
 * frontend should prefer them over re-deriving from `kind`. They are typed
 * optional only for forward/backward compatibility with payloads produced
 * before this field set existed.
 */

import type { ErrorCategory } from '@/lib/errorTaxonomy';

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
  | 'oauth_revoked'
  | 'retry_exhausted'
  | 'keyring_lost'
  | 'authorization_required'
  | 'internal'
  | 'external';

/** Shape of the serialised `AppError` received via Tauri IPC rejection. */
export interface TauriErrorResponse {
  error: string;
  kind: TauriErrorKind;
  /** Canonical category computed backend-side (prefer over `kind`). */
  category?: ErrorCategory;
  /** Whether the healing engine can auto-retry (backend-computed). */
  auto_fixable?: boolean;
  /** Whether this error should trigger provider failover (backend-computed). */
  failover_eligible?: boolean;
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
