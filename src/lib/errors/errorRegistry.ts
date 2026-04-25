// ---------------------------------------------------------------------------
// Error Message Registry
// Maps raw technical error strings/patterns to user-friendly messages
// with recovery suggestions.
// ---------------------------------------------------------------------------

/**
 * High-level intent class for a friendly error. Surfaces to UI so transient,
 * self-healing failures can be presented as "we caught that for you" rather
 * than as hard error states. Mirrored in `useTranslatedError.ts`.
 *
 * - `recoverable`: transient or self-healing — caller should try again
 *   (timeouts, rate limits, stale cache, NotFound after refresh).
 * - `user_action`: requires the user to fix something (validation,
 *   bad passphrase, missing webhook URL, expired session).
 * - `system`: backend / environment problem the user cannot fix
 *   (CLI not installed, network offline, encrypted bundle corrupted).
 * - `unclassified`: generic fallback / unmatched.
 */
export type FriendlyErrorCategory = 'recoverable' | 'user_action' | 'system' | 'unclassified';

export interface FriendlyError {
  /** Plain-language description of what went wrong. */
  message: string;
  /** Actionable suggestion the user can try. */
  suggestion: string;
  /** UI intent class — drives the recovered/illustrated treatment. */
  category: FriendlyErrorCategory;
}

interface ErrorRule {
  /** Substring or regex to match against the raw error string. */
  match: string | RegExp;
  error: FriendlyError;
}

// ---------------------------------------------------------------------------
// Registry — ordered by specificity (most specific first).
// ---------------------------------------------------------------------------

const ERROR_RULES: ErrorRule[] = [
  // ── Network & connectivity ──────────────────────────────────────────
  {
    match: 'NetworkOffline',
    error: {
      message: 'You appear to be offline.',
      suggestion: 'Check your internet connection and try again.',
      category: 'system',
    },
  },
  {
    match: 'timed out',
    error: {
      message: 'The request took too long to complete.',
      suggestion: 'Try again — if the problem persists, simplify your request or check your connection.',
      category: 'recoverable',
    },
  },
  {
    match: 'Failed to build HTTP client',
    error: {
      message: 'Could not establish a network connection.',
      suggestion: 'Check your internet connection and firewall settings.',
      category: 'system',
    },
  },

  // ── Auth & permissions ──────────────────────────────────────────────
  {
    match: 'Auth token missing or invalid',
    error: {
      message: 'Your session has expired or is invalid.',
      suggestion: 'Sign out and sign back in to refresh your session.',
      category: 'user_action',
    },
  },
  {
    match: 'Session expired',
    error: {
      message: 'Your session has expired.',
      suggestion: 'Sign in again to continue.',
      category: 'user_action',
    },
  },
  {
    match: 'OAuth authorization timed out',
    error: {
      message: 'The authorization window was open too long.',
      suggestion: 'Try connecting again and complete the sign-in promptly.',
      category: 'user_action',
    },
  },
  {
    match: 'permission denied',
    error: {
      message: 'You don\'t have permission to perform this action.',
      suggestion: 'Check that you have the right access level, or ask an admin for help.',
      category: 'user_action',
    },
  },
  {
    match: 'Forbidden',
    error: {
      message: 'Access denied.',
      suggestion: 'You may not have permission for this action. Check your credentials or contact an admin.',
      category: 'user_action',
    },
  },

  // ── Rate limiting ───────────────────────────────────────────────────
  {
    match: 'rate limit exceeded',
    error: {
      message: 'Too many requests — slow down.',
      suggestion: 'Wait a moment and try again.',
      category: 'recoverable',
    },
  },
  {
    match: 'RateLimited',
    error: {
      message: 'You\'ve hit a rate limit.',
      suggestion: 'Wait a few seconds before retrying.',
      category: 'recoverable',
    },
  },

  // ── Budget ──────────────────────────────────────────────────────────
  {
    match: 'Budget limit exceeded',
    error: {
      message: 'This agent has reached its spending limit for the month.',
      suggestion: 'Increase the budget in Settings or wait until the next billing cycle.',
      category: 'user_action',
    },
  },
  {
    match: 'budget exceeded',
    error: {
      message: 'Budget limit reached — execution was blocked.',
      suggestion: 'Adjust the agent\'s monthly budget to continue.',
      category: 'user_action',
    },
  },

  // ── CLI / backend ──────────────────────────────────────────────────
  {
    match: 'Claude CLI not found',
    error: {
      message: 'The AI backend (Claude CLI) is not installed.',
      suggestion: 'Install the Claude CLI and restart the app.',
      category: 'system',
    },
  },
  {
    match: 'CLAUDECODE environment variable',
    error: {
      message: 'A configuration conflict is blocking the AI backend.',
      suggestion: 'Restart the app — this usually resolves automatically.',
      category: 'recoverable',
    },
  },
  {
    match: 'Claude CLI exited with error',
    error: {
      message: 'The AI backend returned an unexpected error.',
      suggestion: 'Try again. If it keeps happening, check the Claude CLI logs.',
      category: 'recoverable',
    },
  },
  {
    match: 'CLI produced no output',
    error: {
      message: 'The AI did not return a response.',
      suggestion: 'Try again with a simpler request.',
      category: 'recoverable',
    },
  },

  // ── Design / generation ─────────────────────────────────────────────
  {
    match: 'Failed to extract connector design',
    error: {
      message: 'Could not generate a connector from your description.',
      suggestion: 'Be more specific — include the service name and credential type (e.g. "Stripe API key").',
      category: 'user_action',
    },
  },
  {
    match: 'Failed to generate',
    error: {
      message: 'Generation failed.',
      suggestion: 'Try rephrasing your request with more detail.',
      category: 'recoverable',
    },
  },

  // ── Validation ──────────────────────────────────────────────────────
  {
    match: 'Invalid JSON',
    error: {
      message: 'The data format is invalid.',
      suggestion: 'Check that your input is properly formatted and try again.',
      category: 'user_action',
    },
  },
  {
    match: 'Validation',
    error: {
      message: 'Some input values are invalid.',
      suggestion: 'Review the highlighted fields and correct any errors.',
      category: 'user_action',
    },
  },
  {
    match: 'Request body too large',
    error: {
      message: 'The data you\'re sending is too large.',
      suggestion: 'Reduce the size of your input and try again.',
      category: 'user_action',
    },
  },

  // ── Encryption / decryption ─────────────────────────────────────────
  {
    match: 'Decryption failed',
    error: {
      message: 'Could not decrypt — the passphrase may be wrong or the file is corrupted.',
      suggestion: 'Double-check your passphrase and try again.',
      category: 'user_action',
    },
  },

  // ── Circular chains ─────────────────────────────────────────────────
  {
    match: 'Circular chain detected',
    error: {
      message: 'This would create a loop where agents trigger each other endlessly.',
      suggestion: 'Review your agent chain and remove the circular reference.',
      category: 'user_action',
    },
  },

  // ── Database / connection ───────────────────────────────────────────
  {
    match: 'NotFound',
    error: {
      message: 'The requested item could not be found.',
      suggestion: 'It may have been deleted. Refresh and try again.',
      category: 'recoverable',
    },
  },
  {
    match: 'Connection limit reached',
    error: {
      message: 'Too many active connections.',
      suggestion: 'Disconnect an existing peer before adding a new one.',
      category: 'system',
    },
  },

  // ── Webhooks / automation ───────────────────────────────────────────
  {
    match: /Webhook returned HTTP \d+/,
    error: {
      message: 'The external service returned an error.',
      suggestion: 'Check that the webhook URL is correct and the service is available.',
      category: 'system',
    },
  },
  {
    match: 'Cannot reach Zapier hook',
    error: {
      message: 'Could not reach the Zapier webhook.',
      suggestion: 'Verify the webhook URL in your Zapier integration settings.',
      category: 'user_action',
    },
  },
  {
    match: 'is not active',
    error: {
      message: 'This automation is currently disabled.',
      suggestion: 'Activate the automation before running it.',
      category: 'user_action',
    },
  },
  {
    match: 'no webhook URL configured',
    error: {
      message: 'No webhook URL has been set up for this automation.',
      suggestion: 'Add a webhook URL in the automation settings.',
      category: 'user_action',
    },
  },
  {
    match: 'no platform credential configured',
    error: {
      message: 'This automation is missing its credentials.',
      suggestion: 'Add the required credential in the automation settings.',
      category: 'user_action',
    },
  },

  // ── Import / export ─────────────────────────────────────────────────
  {
    match: 'Bundle file is empty or unreadable',
    error: {
      message: 'The import file is empty or damaged.',
      suggestion: 'Try re-exporting from the source and importing again.',
      category: 'user_action',
    },
  },
  {
    match: 'ZIP archive does not contain manifest',
    error: {
      message: 'This file doesn\'t appear to be a valid export bundle.',
      suggestion: 'Make sure you\'re importing a file that was exported from this app.',
      category: 'user_action',
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const GENERIC_FALLBACK: FriendlyError = {
  message: 'Something went wrong.',
  suggestion: 'Try again. If the problem persists, restart the app or check your connection.',
  category: 'unclassified',
};

/**
 * Resolve a raw error string to a user-friendly message + recovery suggestion.
 * Returns a generic fallback for unrecognised errors.
 */
export function resolveError(raw: string | null | undefined): FriendlyError {
  if (!raw) return GENERIC_FALLBACK;

  for (const rule of ERROR_RULES) {
    const matches =
      typeof rule.match === 'string'
        ? raw.includes(rule.match)
        : rule.match.test(raw);
    if (matches) return rule.error;
  }

  return GENERIC_FALLBACK;
}

// ---------------------------------------------------------------------------
// Severity label humaniser (for healing / alert toasts)
// ---------------------------------------------------------------------------

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Needs immediate attention',
  high: 'Important issue',
  medium: 'Minor issue',
  low: 'Informational',
};

/** Convert a severity code like "critical" to a human-readable label. */
export function friendlySeverity(severity: string): string {
  return SEVERITY_LABELS[severity] ?? severity;
}
