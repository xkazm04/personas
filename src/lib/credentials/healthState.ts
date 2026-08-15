import { parseJsonOrDefault } from '@/lib/utils/parseJson';

/**
 * Three-valued health of a credential, mirroring the backend `HealthProbeState`
 * (engine/healthcheck.rs):
 * - `verified`     — a live probe ran and passed
 * - `unverifiable` — the connector has no live probe; stored but not checkable
 * - `failed`       — a live probe ran and failed
 * - `untested`     — never probed
 */
export type HealthState = 'verified' | 'unverifiable' | 'failed' | 'untested';

/**
 * The subset of a credential this resolver actually reads. Structural rather
 * than nominal so every caller can use it — the nine sites this exists to
 * replace hold credentials typed five different ways.
 */
export interface CredentialHealthFields {
  metadata: string | null;
  healthcheck_last_success: boolean | null;
}

/**
 * Read the typed health state from a credential. Prefers the persisted
 * `healthcheck_last_state` token (written by the backend probe path); falls
 * back to the legacy `healthcheck_last_success` boolean for credentials probed
 * before the typed state landed. Both come from persisted metadata — no
 * re-probe.
 *
 * **Use this instead of comparing `healthcheck_last_success` to true directly.**
 * That boolean has three meanings and the comparison collapses two of them:
 * a connector with no live probe is `unverifiable`, and a credential that was
 * never probed is `untested`, but both are *not-true* and so read as "not
 * healthy" — or, worse, the reverse, since the backend once stored
 * "could not check" as `true`. Measured 2026-08-15: 8 of 25 live credentials
 * are `unverifiable`, and 4 of the 19 showing Ready (21%) rest on a verdict
 * that was never a probe.
 *
 * The backend already learned this — `summarize_probe_states` exists precisely
 * because the conflation was a bug, and it was fixed for the bulk summary and
 * left standing at nine frontend sites.
 *
 * Extracted here from `features/vault/.../credentialListTypes.ts` on
 * 2026-08-15, which re-exports it for its existing callers. It lives in `lib/`
 * because five different features need it and none of them should be importing
 * from inside the vault feature to get it.
 */
export function readCredentialHealthState(cred: CredentialHealthFields): HealthState {
  const parsed = parseJsonOrDefault<Record<string, unknown> | null>(cred.metadata, null);
  const token = parsed?.healthcheck_last_state;
  if (token === 'verified' || token === 'unverifiable' || token === 'failed') {
    return token;
  }
  if (cred.healthcheck_last_success === null) return 'untested';
  return cred.healthcheck_last_success ? 'verified' : 'failed';
}

/** True only when a live probe ran and passed. */
export function isCredentialVerified(cred: CredentialHealthFields | null | undefined): boolean {
  return cred ? readCredentialHealthState(cred) === 'verified' : false;
}
