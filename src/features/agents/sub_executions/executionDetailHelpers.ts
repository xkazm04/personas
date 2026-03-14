import type { LucideIcon } from 'lucide-react';
import { Clock, Key, Zap, Settings, Shield, XCircle, AlertTriangle } from 'lucide-react';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';

export { hasNonEmptyJson } from '@/lib/utils/parseJson';

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

export const ERROR_PATTERNS: Array<{ pattern: RegExp; summary: string; guidance: string; severity: ErrorSeverity; action?: ErrorAction }> = [
  { pattern: /api key/i, severity: 'critical', summary: 'API key issue detected.', guidance: 'Check that your API key is valid and hasn\'t expired.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
  { pattern: /invalid.*key|invalid_api_key|authentication|unauthorized|401/i, severity: 'critical', summary: 'Authentication failed.', guidance: 'Your API key may be invalid or expired.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
  { pattern: /rate.?limit|429|too many requests/i, severity: 'warning', summary: 'Rate limit reached.', guidance: 'The API rate limit was hit. Try reducing the trigger frequency.', action: { label: 'Edit Triggers', icon: Zap, navigate: 'triggers' } },
  { pattern: /timeout|timed?\s*out|ETIMEDOUT|ESOCKETTIMEDOUT/i, severity: 'warning', summary: 'The operation timed out.', guidance: 'The request took too long. Adjust the timeout in persona settings.', action: { label: 'Persona Settings', icon: Settings, navigate: 'persona-settings' } },
  { pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND|network|DNS/i, severity: 'info', summary: 'Network connection failed.', guidance: 'Could not reach the server. Check your internet connection and that the target service is available.' },
  { pattern: /permission.?denied|forbidden|403/i, severity: 'critical', summary: 'Permission denied.', guidance: 'The tool or API denied access. Verify your credentials have the necessary permissions.', action: { label: 'Check Credentials', icon: Shield, navigate: 'vault' } },
  { pattern: /quota|billing|payment|insufficient.?funds|402/i, severity: 'warning', summary: 'Account quota or billing issue.', guidance: 'Your API account may have reached its spending limit. Check your account billing status.' },
  { pattern: /spawn\s+ENOENT|command not found|not recognized/i, severity: 'critical', summary: 'Required command not found.', guidance: 'A system command needed for this execution is not installed. Check that all required CLI tools are available on your system.' },
  { pattern: /exit\s+code\s+1|exited?\s+with\s+1/i, severity: 'info', summary: 'The process exited with an error.', guidance: 'The underlying process reported a failure. Check the execution log for more details.' },
  { pattern: /ENOMEM|out of memory/i, severity: 'warning', summary: 'Out of memory.', guidance: 'The system ran out of memory. Try closing other applications or reducing the task complexity.' },
  { pattern: /500|internal.?server.?error/i, severity: 'warning', summary: 'The remote server encountered an error.', guidance: 'The API returned a server error. This is usually temporary -- try again in a few minutes.' },
  { pattern: /JSON|parse|unexpected token/i, severity: 'info', summary: 'Failed to parse response data.', guidance: 'The response was not in the expected format. This may indicate an API change or malformed data.' },
  { pattern: /credential|secret|token/i, severity: 'critical', summary: 'Credential issue.', guidance: 'A required credential may be missing or invalid.', action: { label: 'Go to Vault', icon: Key, navigate: 'vault' } },
];

export function getErrorExplanation(errorMessage: string): { summary: string; guidance: string; severity: ErrorSeverity; action?: ErrorAction } | null {
  for (const { pattern, summary, guidance, severity, action } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return { summary, guidance, severity, action };
    }
  }
  return null;
}
