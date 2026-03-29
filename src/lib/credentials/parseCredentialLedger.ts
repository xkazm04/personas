import type { CredentialLedger } from '@/lib/bindings/CredentialLedger';

const EMPTY_LEDGER: CredentialLedger = {
  healthcheck_results: [],
  healthcheck_last_success: null,
  healthcheck_last_success_at: null,
  anomaly_score: null,
  anomaly_tolerance: null,
  environment: null,
  oauth_token_expires_at: null,
  oauth_refresh_count: null,
  oauth_last_refresh_at: null,
  oauth_predicted_lifetime_secs: null,
  oauth_refresh_backoff_until: null,
  oauth_refresh_fail_count: null,
  needs_reauth: null,
  needs_reauth_at: null,
  usage_count: null,
  last_used_at: null,
};

/**
 * Parse a credential's `metadata` JSON string into a typed `CredentialLedger`.
 * Returns a default (empty) ledger if the input is null or invalid JSON.
 */
export function parseCredentialLedger(metadata: string | null): CredentialLedger {
  if (!metadata) return { ...EMPTY_LEDGER };
  try {
    return { ...EMPTY_LEDGER, ...JSON.parse(metadata) };
  } catch {
    return { ...EMPTY_LEDGER };
  }
}
