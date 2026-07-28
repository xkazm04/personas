import type { CredentialMetadata } from '@/lib/types/types';

export type HealthProbeState = 'verified' | 'unverifiable' | 'failed';

export interface ConnectorTestResult {
  success: boolean;
  message: string;
  /**
   * Three-valued probe outcome from the backend. `unverifiable` means the
   * connector has no live probe at all (no HTTP healthcheck, no CLI verify, no
   * desktop-presence check), so the credential is stored but nothing was
   * actually checked — reporting it as a green "Ready" would be a claim we
   * cannot support. Null on results predating the token; fall back to `success`.
   */
  state?: HealthProbeState | null;
  /** ISO timestamp of the test, when known. Only set for restored results. */
  testedAt?: string | null;
  /**
   * True when the result was restored from the credential's persisted
   * healthcheck rather than produced by a test in this session — the UI says
   * "last checked <when>" instead of implying it just ran.
   */
  cached?: boolean;
}

/**
 * How old a restored healthcheck may be before the row nudges for a re-test.
 * A day is long enough that a working setup isn't nagged every session, short
 * enough that "it worked yesterday" isn't treated as evidence about today.
 */
export const STALE_HEALTHCHECK_MS = 24 * 60 * 60 * 1000;

/**
 * True when a result was restored from persistence AND is old enough that it
 * should not be trusted as current. Live results from this session are never
 * stale — the user just watched them run.
 */
export function isStaleResult(result: ConnectorTestResult | null, now = Date.now()): boolean {
  if (!result?.cached || !result.testedAt) return false;
  const testedAt = Date.parse(result.testedAt);
  if (Number.isNaN(testedAt)) return false;
  return now - testedAt > STALE_HEALTHCHECK_MS;
}

export interface ConnectorStatus {
  name: string;
  credentialId: string | null;
  credentialName: string | null;
  testing: boolean;
  result: ConnectorTestResult | null;
  /** Transient error from the last credential link attempt. */
  linkError: string | null;
}

/**
 * Restore a connector's last known healthcheck from the credential record.
 *
 * Test outcomes used to live only in component state, so every visit to the
 * connectors surface opened blank and silently re-tested — even though the
 * backend had already persisted the answer on the credential. Returns null when
 * the credential has never been tested, which leaves the auto-test path free to
 * fire for genuinely unknown connectors.
 */
export function restoreHealthcheck(cred: CredentialMetadata | null | undefined): ConnectorTestResult | null {
  if (!cred || typeof cred.healthcheck_last_success !== 'boolean') return null;
  return {
    success: cred.healthcheck_last_success,
    message: cred.healthcheck_last_message ?? '',
    state: cred.healthcheck_last_state,
    testedAt: cred.healthcheck_last_tested_at,
    cached: true,
  };
}

// -- Connector readiness ----------------------------------------------
//
// Execution requires a linked credential (any readiness except 'unlinked').
// A passing healthcheck ('healthy') is recommended but not strictly required --
// connectors with 'linked_untested' or 'unhealthy' status will attempt execution
// but may fail at runtime.

export type ConnectorReadiness =
  | 'unlinked'        // no credential linked -- blocks execution
  | 'linked_untested' // credential linked, not yet tested
  | 'healthy'         // credential linked, healthcheck passed
  | 'unverifiable'    // credential linked, but the connector has no live probe
  | 'unhealthy';      // credential linked, healthcheck failed

export function deriveReadiness(status: ConnectorStatus): ConnectorReadiness {
  if (!status.credentialId) return 'unlinked';
  if (!status.result) return 'linked_untested';
  // `unverifiable` is NOT a failure: `credential_is_usable` only demotes an
  // explicit probe failure, so these still count as execution-ready. It is
  // separated from `healthy` purely so the UI stops claiming a green check
  // nothing earned.
  if (status.result.state === 'unverifiable') return 'unverifiable';
  return status.result.success ? 'healthy' : 'unhealthy';
}

/** True if the connector has a linked credential (minimum for execution). */
export function isExecutionReady(status: ConnectorStatus): boolean {
  return deriveReadiness(status) !== 'unlinked';
}

/**
 * Focusable health states. Mirrors the vault credential list's filter options
 * (healthy / unverifiable / failing / untested) and adds `stale`, which is
 * specific to this surface — the vault has no notion of a restored result
 * ageing out.
 */
export type ConnectorHealthFilter = ConnectorReadiness | 'stale';

/** Does a connector belong under the given health filter? */
export function matchesHealthFilter(status: ConnectorStatus, filter: ConnectorHealthFilter | null): boolean {
  if (!filter) return true;
  if (filter === 'stale') return isStaleResult(status.result);
  return deriveReadiness(status) === filter;
}

/** True when the connector is stored but nothing could actually verify it. */
export function isUnverifiable(status: ConnectorStatus): boolean {
  return deriveReadiness(status) === 'unverifiable';
}

// -- UI status config -------------------------------------------------
//
// `labelKey` is the trailing segment of `t.agents.connectors.<labelKey>`.
// Consumers read the localized label via
// `t.agents.connectors[STATUS_CONFIG[key].labelKey]` rather than the raw
// English string. Keeps display labels in en.json (per the
// "Constants-with-labels" graduated rule from
// Patterns/explorer-preferences.md).

export const STATUS_CONFIG = {
  ready: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', labelKey: 'status_ready' },
  untested: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', labelKey: 'status_untested' },
  unverifiable: { color: 'text-foreground', bg: 'bg-secondary/40 border-primary/15', labelKey: 'status_unverifiable' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', labelKey: 'status_failed' },
  missing: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', labelKey: 'status_missing' },
  testing: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', labelKey: 'status_testing' },
} as const;

export function getStatusKey(status: ConnectorStatus): keyof typeof STATUS_CONFIG {
  if (status.testing) return 'testing';
  if (!status.credentialId) return 'missing';
  if (!status.result) return 'untested';
  if (status.result.state === 'unverifiable') return 'unverifiable';
  return status.result.success ? 'ready' : 'failed';
}
