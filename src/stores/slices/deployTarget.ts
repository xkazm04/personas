/**
 * Shared DeployTarget abstraction for Cloud and GitLab deployment slices.
 *
 * Unifies the duplicated patterns:
 * - Error translation (shared cases across both targets)
 * - Connection state management (isConnecting, error, config)
 * - Initialize / connect / disconnect lifecycle
 */

// ── Shared error translation ────────────────────────────────────────

interface ErrorRule {
  patterns: string[];
  message: string;
}

/** Error rules shared across all deploy targets. */
const SHARED_ERROR_RULES: ErrorRule[] = [
  // Connection / network
  { patterns: ['not reachable', 'connection refused', 'connect error'], message: 'Could not reach the server. Check the URL and your network connection.' },
  { patterns: ['timed out', 'timeout'], message: 'Connection timed out. The server may be down or the URL may be incorrect.' },
  { patterns: ['dns', 'resolve', 'no such host'], message: 'Could not resolve the hostname. Double-check the URL for typos.' },
  // Auth
  { patterns: ['401', 'unauthorized'], message: 'Invalid credentials. Please verify and try again.' },
  { patterns: ['403', 'forbidden'], message: 'Access denied. Your credentials may not have the required permissions.' },
  // Server
  { patterns: ['500', 'internal server error'], message: 'The server returned an internal error. Try again in a few minutes.' },
  { patterns: ['502', '503', '504', 'bad gateway', 'service unavailable'], message: 'The server is temporarily unavailable. Try again shortly.' },
  // Not connected
  { patterns: ['not connected'], message: 'Not connected. Please connect first.' },
  // Keyring
  { patterns: ['keyring'], message: 'Could not access stored credentials. You may need to reconnect.' },
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

// ── Cloud-specific error rules ──────────────────────────────────────

export const CLOUD_ERROR_RULES: ErrorRule[] = [
  { patterns: ['oauth', 'expired'], message: 'OAuth token has expired. Please re-authorize.' },
  { patterns: ['url must not be empty'], message: 'Please enter the orchestrator URL.' },
  { patterns: ['api key must not be empty'], message: 'Please enter your API key.' },
];

export const CLOUD_ERROR_PREFIX = /^Cloud error:\s*/i;

export function translateCloudError(err: unknown): string {
  return translateDeployError(err, CLOUD_ERROR_RULES, CLOUD_ERROR_PREFIX);
}

// ── GitLab-specific error rules ─────────────────────────────────────

export const GITLAB_ERROR_RULES: ErrorRule[] = [
  { patterns: ['token must not be empty'], message: 'Please enter your GitLab personal access token.' },
];

export const GITLAB_ERROR_PREFIX = /^GitLab error:\s*/i;

export function translateGitLabError(err: unknown): string {
  return translateDeployError(err, GITLAB_ERROR_RULES, GITLAB_ERROR_PREFIX);
}

// ── Connection state helpers ────────────────────────────────────────

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
