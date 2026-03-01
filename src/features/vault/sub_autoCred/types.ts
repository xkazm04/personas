import type { CredentialDesignResult, CredentialDesignConnector } from '@/hooks/design/useCredentialDesign';
import type { CredentialTemplateField } from '@/lib/types/types';

/** Phases the auto-credential session moves through */
export type AutoCredPhase =
  | 'consent'
  | 'browser'
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
