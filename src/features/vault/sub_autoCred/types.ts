import type { CredentialDesignResult, CredentialDesignConnector } from '@/hooks/design/useCredentialDesign';
import type { CredentialTemplateField } from '@/lib/types/types';

/** Phases the auto-credential session moves through */
export type AutoCredPhase =
  | 'consent'
  | 'browser'
  | 'browser-error'  // error occurred but terminal stays visible
  | 'review'
  | 'saving'
  | 'done'
  | 'error';

/** A single log line emitted during browser automation */
export interface BrowserLogEntry {
  ts: number;
  message: string;
  type: 'info' | 'action' | 'warning' | 'error';
}

/** Values extracted from the browser session, keyed by field key */
export type ExtractedValues = Record<string, string>;

/** Structured error returned from backend (JSON-parsed from error string) */
export interface AutoCredErrorInfo {
  kind: 'cli_not_found' | 'spawn_failed' | 'timeout' | 'env_conflict' | 'cli_error' | 'extraction_failed';
  message: string;
  guidance: string;
  retryable: boolean;
  context: SessionContext | null;
}

/** Last-mile session context captured during browser automation */
export interface SessionContext {
  last_url: string | null;
  last_actions: string[];
  tool_call_count: number;
  duration_secs: number | null;
  had_waiting_prompt: boolean;
}

/** Parse backend error string — returns structured info or wraps raw string */
export function parseAutoCredError(raw: string): AutoCredErrorInfo {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.kind === 'string') return parsed as AutoCredErrorInfo;
  } catch { /* not JSON */ }
  return {
    kind: 'cli_error',
    message: raw,
    guidance: 'An unexpected error occurred. Try again or set up the credential manually.',
    retryable: true,
    context: null,
  };
}

/** Context built from the design result for browser automation */
export interface AutoCredConnectorContext {
  connector: CredentialDesignConnector;
  docsUrl: string | null;
  setupInstructions: string | null;
  fields: CredentialTemplateField[];
}

/** Build a context object from a CredentialDesignResult */
export function buildConnectorContext(result: CredentialDesignResult): AutoCredConnectorContext {
  const fields: CredentialTemplateField[] = result.connector.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type as CredentialTemplateField['type'],
    required: f.required,
    placeholder: f.placeholder,
    helpText: f.helpText,
  }));

  // Extract docs URL from setup_instructions (first URL found)
  let docsUrl: string | null = null;
  if (result.setup_instructions) {
    const match = result.setup_instructions.match(/https?:\/\/[^\s)]+/);
    if (match) docsUrl = match[0];
  }

  return {
    connector: result.connector,
    docsUrl,
    setupInstructions: result.setup_instructions || null,
    fields,
  };
}
