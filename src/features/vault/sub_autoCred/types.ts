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
  type: 'info' | 'action' | 'warning' | 'error' | 'url' | 'input_request';
  /** URL associated with this entry (for type='url') */
  url?: string;
}

/** Mode of the auto-credential session */
export type AutoCredMode = 'playwright' | 'guided';

/** Values extracted from the browser session, keyed by field key */
export type ExtractedValues = Record<string, string>;

// ── Partial Extraction Contract ──────────────────────────────────────

/**
 * An extraction is **partial** when the adapter could not fill every
 * required field defined in the connector schema.
 *
 * Adapters MUST set `partial: true` when:
 *  - One or more required fields have an empty or missing value.
 *  - The browser session was interrupted before all fields were captured.
 *  - The adapter detected a page layout it could not parse fully.
 *
 * Adapters SHOULD set `partial: false` only when every required field
 * has a non-empty value.
 */

/** Per-field completeness status produced by `checkFieldCompleteness`. */
export interface FieldCompletenessEntry {
  key: string;
  label: string;
  required: boolean;
  filled: boolean;
}

/** Summary of extraction completeness across all fields. */
export interface ExtractionCompleteness {
  /** True when one or more required fields are empty. */
  isPartial: boolean;
  /** Number of required fields that have a non-empty value. */
  filledRequired: number;
  /** Total number of required fields. */
  totalRequired: number;
  /** Per-field breakdown. */
  fields: FieldCompletenessEntry[];
  /** Keys of required fields that are missing. */
  missingKeys: string[];
}

/** Compute field-level completeness for extracted values against a schema. */
export function checkFieldCompleteness(
  fields: CredentialTemplateField[],
  values: ExtractedValues,
): ExtractionCompleteness {
  const entries: FieldCompletenessEntry[] = fields.map((f) => ({
    key: f.key,
    label: f.label,
    required: !!f.required,
    filled: !!(values[f.key] ?? '').trim(),
  }));

  const requiredEntries = entries.filter((e) => e.required);
  const missingKeys = requiredEntries.filter((e) => !e.filled).map((e) => e.key);

  return {
    isPartial: missingKeys.length > 0,
    filledRequired: requiredEntries.length - missingKeys.length,
    totalRequired: requiredEntries.length,
    fields: entries,
    missingKeys,
  };
}

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
  last_assistant_text: string | null;
}

/** Parse backend error string — returns structured info or wraps raw string */
export function parseAutoCredError(raw: string): AutoCredErrorInfo {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.kind === 'string') return parsed as AutoCredErrorInfo;
  } catch { /* intentional: non-critical -- JSON parse fallback */ }

  // Derive a better guidance message from the raw error text
  const lower = raw.toLowerCase();
  let guidance: string;
  if (lower.includes('timed out')) {
    guidance = 'The session timed out. The service may be slow or require manual interaction.';
  } else if (lower.includes('not found') || lower.includes('cli not found')) {
    guidance = 'Claude CLI is not installed or not accessible. Install it and try again.';
  } else if (lower.includes('api key') || lower.includes('credit') || lower.includes('billing')) {
    guidance = 'There may be an issue with your API key or billing. Check your Anthropic account.';
  } else if (raw.length > 30) {
    guidance = raw;
  } else {
    guidance = 'The session failed unexpectedly. Check the session log for details, or set up the credential manually.';
  }

  return {
    kind: 'cli_error',
    message: raw,
    guidance,
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
