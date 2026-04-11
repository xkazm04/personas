/**
 * Shared DeployTarget abstraction for Cloud and GitLab deployment slices.
 *
 * Unifies the duplicated patterns:
 * - Error translation (shared cases across both targets)
 * - Connection state management (isConnecting, error, config)
 * - Initialize / connect / disconnect lifecycle
 */

// -- Shared error translation ----------------------------------------

import { en } from "@/i18n/en";

interface ErrorRule {
  patterns: string[];
  message: string;
}

/** Error rules shared across all deploy targets. */
const SHARED_ERROR_RULES: ErrorRule[] = [
  // Connection / network
  { patterns: ['not reachable', 'connection refused', 'connect error'], message: en.deploy_errors.not_reachable },
  { patterns: ['timed out', 'timeout'], message: en.deploy_errors.timed_out },
  { patterns: ['dns', 'resolve', 'no such host'], message: en.deploy_errors.dns_resolve },
  // Auth
  { patterns: ['401', 'unauthorized'], message: en.deploy_errors.unauthorized },
  { patterns: ['403', 'forbidden'], message: en.deploy_errors.forbidden },
  // Server
  { patterns: ['500', 'internal server error'], message: en.deploy_errors.internal_server_error },
  { patterns: ['502', '503', '504', 'bad gateway', 'service unavailable'], message: en.deploy_errors.service_unavailable },
  // Not connected
  { patterns: ['not connected'], message: en.deploy_errors.not_connected },
  // Keyring
  { patterns: ['keyring'], message: en.deploy_errors.keyring },
];

/**
 * Translate a raw error into a user-friendly message.
 *
 * Checks target-specific rules first, then shared rules, then falls back
 * to stripping a common prefix from the raw string.
 */
export function translateDeployError(
  err: unknown,
  targetRules: ErrorRule[],
  prefixStrip: RegExp,
): string {
  const raw = String(err).toLowerCase();

  // Target-specific rules first (higher priority)
  for (const rule of targetRules) {
    if (rule.patterns.some((p) => raw.includes(p))) return rule.message;
  }

  // Shared rules
  for (const rule of SHARED_ERROR_RULES) {
    if (rule.patterns.some((p) => raw.includes(p))) return rule.message;
  }

  // Fallback
  return String(err).replace(prefixStrip, '');
}

// -- Cloud-specific error rules --------------------------------------

export const CLOUD_ERROR_RULES: ErrorRule[] = [
  { patterns: ['oauth', 'expired'], message: en.deploy_errors.oauth_expired },
  { patterns: ['url must not be empty'], message: en.deploy_errors.url_empty },
  { patterns: ['api key must not be empty'], message: en.deploy_errors.api_key_empty },
];

export const CLOUD_ERROR_PREFIX = /^Cloud error:\s*/i;

export function translateCloudError(err: unknown): string {
  return translateDeployError(err, CLOUD_ERROR_RULES, CLOUD_ERROR_PREFIX);
}

// -- GitLab-specific error rules -------------------------------------

export const GITLAB_ERROR_RULES: ErrorRule[] = [
  { patterns: ['token must not be empty'], message: en.deploy_errors.token_empty },
];

export const GITLAB_ERROR_PREFIX = /^GitLab error:\s*/i;

export function translateGitLabError(err: unknown): string {
  return translateDeployError(err, GITLAB_ERROR_RULES, GITLAB_ERROR_PREFIX);
}

// -- Connection state helpers ----------------------------------------

export type DeployConnectionPhase = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Derive the connection phase from common slice state fields.
 */
export function deriveConnectionPhase(
  config: { is_connected?: boolean } | null,
  isConnecting: boolean,
  error: string | null,
): DeployConnectionPhase {
  if (isConnecting) return 'connecting';
  if (error) return 'error';
  if (config?.is_connected) return 'connected';
  return 'disconnected';
}

/**
 * Check whether a reconnect error is an auth error (user should be notified)
 * vs a network error (stay quiet).
 */
export function isAuthError(err: unknown): boolean {
  // Prefer structured kind from Tauri errors
  if (typeof err === 'object' && err !== null && 'kind' in err) {
    const kind = (err as { kind: string }).kind;
    return kind === 'auth' || kind === 'forbidden';
  }
  const raw = String(err).toLowerCase();
  return (
    raw.includes('401') ||
    raw.includes('unauthorized') ||
    raw.includes('403') ||
    raw.includes('forbidden') ||
    raw.includes('expired') ||
    raw.includes('revoked')
  );
}
