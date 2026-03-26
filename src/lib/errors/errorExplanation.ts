// ---------------------------------------------------------------------------
// Canonical error explanation module.
//
// Merges the previously-duplicated ERROR_PATTERNS from:
//   - sub_executions/detail/executionDetailTypes.ts
//   - sub_executions/executionDetailHelpers.ts
//   - sub_executions/libs/useExecutionDetail.ts
// and incorporates additional patterns from errorRegistry.ts (budget,
// encryption, webhooks, import/export, CLI, etc.).
//
// Also wires in errorTaxonomy.classifyError() so every explanation carries
// a consistent ErrorCategory alongside the UI-facing severity.
// ---------------------------------------------------------------------------

import { Key, Zap, Settings, Shield, Clock, XCircle, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';
import { classifyError, type ErrorCategory } from '@/lib/errorTaxonomy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorAction {
  label: string;
  icon: LucideIcon;
  /** Navigation target: which sidebar section + optional sub-navigation */
  navigate: 'vault' | 'triggers' | 'persona-settings';
}

export type ErrorSeverity = 'critical' | 'warning' | 'info';

export const SEVERITY_ICONS: Record<ErrorSeverity, { icon: LucideIcon; iconColor: string }> = {
  critical: { icon: XCircle, iconColor: 'text-red-400' },
  warning:  { icon: AlertTriangle, iconColor: 'text-amber-400' },
  info:     { icon: Clock, iconColor: 'text-yellow-400' },
};

export const SEVERITY_TO_TOKEN: Record<ErrorSeverity, keyof typeof SEVERITY_STYLES> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

// ---------------------------------------------------------------------------
// Merged ERROR_PATTERNS (ordered by specificity, most specific first)
// ---------------------------------------------------------------------------

export const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  summary: string;
  guidance: string;
  severity: ErrorSeverity;
  action?: ErrorAction;
}> = [
  // ── Auth & credentials ──────────────────────────────────────────────
  { pattern: /api key/i, severity: 'critical', summary: 'API key issue detected.', guidance: 'Check that your API key is valid and hasn\'t expired.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
  { pattern: /invalid.*key|invalid_api_key|authentication|unauthorized|401/i, severity: 'critical', summary: 'Authentication failed.', guidance: 'Your API key may be invalid or expired.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
  { pattern: /credential|secret|token/i, severity: 'critical', summary: 'Credential issue.', guidance: 'A required credential may be missing or invalid.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
  { pattern: /permission.?denied|forbidden|403/i, severity: 'critical', summary: 'Permission denied.', guidance: 'The tool or API denied access. Verify your credentials have the necessary permissions.', action: { label: 'Check Credentials', icon: Shield, navigate: 'vault' } },

  // ── Rate limiting & quotas ──────────────────────────────────────────
  { pattern: /rate.?limit|429|too many requests/i, severity: 'warning', summary: 'Rate limit reached.', guidance: 'The API rate limit was hit. Try reducing the trigger frequency.', action: { label: 'Edit Triggers', icon: Zap, navigate: 'triggers' } },
  { pattern: /quota|billing|payment|insufficient.?funds|402/i, severity: 'warning', summary: 'Account quota or billing issue.', guidance: 'Your API account may have reached its spending limit. Check your account billing status.' },

  // ── Budget (from errorRegistry) ─────────────────────────────────────
  { pattern: /budget.?limit|budget.?exceeded/i, severity: 'warning', summary: 'Budget limit reached.', guidance: 'This agent has reached its spending limit. Increase the budget in Settings or wait until the next billing cycle.', action: { label: 'Persona Settings', icon: Settings, navigate: 'persona-settings' } },

  // ── Timeouts ────────────────────────────────────────────────────────
  { pattern: /timeout|timed?\s*out|ETIMEDOUT|ESOCKETTIMEDOUT/i, severity: 'warning', summary: 'The operation timed out.', guidance: 'The request took too long. Adjust the timeout in persona settings.', action: { label: 'Persona Settings', icon: Settings, navigate: 'persona-settings' } },

  // ── Network ─────────────────────────────────────────────────────────
  { pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND|network|DNS/i, severity: 'info', summary: 'Network connection failed.', guidance: 'Could not reach the server. Check your internet connection and that the target service is available.' },

  // ── CLI / system ────────────────────────────────────────────────────
  { pattern: /spawn\s+ENOENT|command not found|not recognized/i, severity: 'critical', summary: 'Required command not found.', guidance: 'A system command needed for this execution is not installed. Check that all required CLI tools are available on your system.' },
  { pattern: /Claude CLI not found/i, severity: 'critical', summary: 'The AI backend (Claude CLI) is not installed.', guidance: 'Install the Claude CLI and restart the app.' },

  // ── Memory ──────────────────────────────────────────────────────────
  { pattern: /ENOMEM|out of memory/i, severity: 'warning', summary: 'Out of memory.', guidance: 'The system ran out of memory. Try closing other applications or reducing the task complexity.' },

  // ── Server errors ───────────────────────────────────────────────────
  { pattern: /500|internal.?server.?error/i, severity: 'warning', summary: 'The remote server encountered an error.', guidance: 'The API returned a server error. This is usually temporary -- try again in a few minutes.' },

  // ── Encryption (from errorRegistry) ─────────────────────────────────
  { pattern: /decryption failed|decrypt/i, severity: 'critical', summary: 'Decryption failed.', guidance: 'Could not decrypt — the passphrase may be wrong or the file is corrupted. Double-check your passphrase and try again.' },

  // ── Webhooks (from errorRegistry) ───────────────────────────────────
  { pattern: /webhook returned HTTP|cannot reach.*hook|no webhook URL configured/i, severity: 'warning', summary: 'Webhook delivery issue.', guidance: 'Check that the webhook URL is correct and the external service is available.' },

  // ── Import / export (from errorRegistry) ────────────────────────────
  { pattern: /bundle file is empty|ZIP archive does not contain manifest/i, severity: 'warning', summary: 'Import file is invalid.', guidance: 'The import file is empty or damaged. Try re-exporting from the source and importing again.' },

  // ── Circular chains (from errorRegistry) ────────────────────────────
  { pattern: /circular chain detected/i, severity: 'critical', summary: 'Circular agent chain detected.', guidance: 'This would create a loop where agents trigger each other endlessly. Review your agent chain and remove the circular reference.' },

  // ── Parse / validation ──────────────────────────────────────────────
  { pattern: /JSON|parse|unexpected token/i, severity: 'info', summary: 'Failed to parse response data.', guidance: 'The response was not in the expected format. This may indicate an API change or malformed data.' },

  // ── Process exit ────────────────────────────────────────────────────
  { pattern: /exit\s+code\s+1|exited?\s+with\s+1/i, severity: 'info', summary: 'The process exited with an error.', guidance: 'The underlying process reported a failure. Check the execution log for more details.' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ErrorExplanation {
  summary: string;
  guidance: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  action?: ErrorAction;
}

/**
 * Match an error message against the canonical pattern list and return a
 * user-friendly explanation with severity, guidance, and an optional action.
 *
 * Also attaches an `ErrorCategory` from `errorTaxonomy.classifyError()` so
 * classification and explanation are always consistent.
 */
export function getErrorExplanation(errorMessage: string): ErrorExplanation | null {
  for (const { pattern, summary, guidance, severity, action } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return { summary, guidance, severity, category: classifyError(errorMessage), action };
    }
  }
  return null;
}
