import { useState, useCallback, useRef } from 'react';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import { usePersonaStore } from '@/stores/personaStore';
import type {
  AutoCredPhase,
  BrowserLogEntry,
  ExtractedValues,
  AutoCredConnectorContext,
} from './types';
import { buildConnectorContext } from './types';

/**
 * Playwright MCP adapter interface.
 *
 * The hook talks to the Playwright MCP server via this adapter.
 * In production the browser session would be driven by:
 *   1. `playwright_navigate` → docs_url or setup page
 *   2. `playwright_snapshot` → read page
 *   3. `playwright_click` / `playwright_fill` → interact
 *   4. `playwright_snapshot` → extract created key
 *
 * The adapter is swappable: stub for development, real MCP for production.
 */
export interface PlaywrightAdapter {
  run(
    ctx: AutoCredConnectorContext,
    onLog: (entry: BrowserLogEntry) => void,
    signal: AbortSignal,
  ): Promise<ExtractedValues>;
}

// ── Default stub adapter (simulates browser session) ────────────────────

const stubAdapter: PlaywrightAdapter = {
  async run(ctx, onLog, signal) {
    const log = (message: string, type: BrowserLogEntry['type'] = 'info') =>
      onLog({ ts: Date.now(), message, type });

    log('Initializing Playwright MCP session...', 'info');

    await delay(600, signal);
    log(`Navigating to ${ctx.docsUrl ?? ctx.connector.label + ' dashboard'}`, 'action');

    await delay(1200, signal);
    log('Page loaded — scanning for credential creation form', 'info');

    await delay(800, signal);
    if (ctx.setupInstructions) {
      log('Following setup instructions from design analysis', 'info');
    }

    for (const field of ctx.fields) {
      await delay(500, signal);
      log(`Looking for "${field.label}" input field`, 'action');
      await delay(400, signal);
      log(`Found field: ${field.label}${field.required ? ' (required)' : ''}`, 'info');
    }

    await delay(1000, signal);
    log('Clicking "Generate" / "Create" button', 'action');

    await delay(1500, signal);
    log('Extracting generated credential values...', 'action');

    const values: ExtractedValues = {};
    for (const field of ctx.fields) {
      values[field.key] = field.type === 'password'
        ? `extracted_${field.key}_••••••`
        : `extracted_${field.key}_value`;
    }

    log('Extraction complete — ready for review', 'info');
    return values;
  },
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

// ── Hook ────────────────────────────────────────────────────────────────

interface UseAutoCredSessionOptions {
  adapter?: PlaywrightAdapter;
}

export function useAutoCredSession(options?: UseAutoCredSessionOptions) {
  const adapter = options?.adapter ?? stubAdapter;
  const abortRef = useRef<AbortController | null>(null);

  const createCredential = usePersonaStore((s) => s.createCredential);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const healthcheckPreview = usePersonaStore((s) => s.healthcheckCredentialPreview);

  const [phase, setPhase] = useState<AutoCredPhase>('consent');
  const [designResult, setDesignResult] = useState<CredentialDesignResult | null>(null);
  const [logs, setLogs] = useState<BrowserLogEntry[]>([]);
  const [extractedValues, setExtractedValues] = useState<ExtractedValues>({});
  const [credentialName, setCredentialName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [healthResult, setHealthResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /** Initialize a session from a design result */
  const init = useCallback((result: CredentialDesignResult) => {
    setDesignResult(result);
    setPhase('consent');
    setLogs([]);
    setExtractedValues({});
    setCredentialName(`${result.connector.label} Credential`);
    setError(null);
    setHealthResult(null);
    setIsSaving(false);
  }, []);

  /** User consented — start browser automation */
  const startBrowser = useCallback(async () => {
    if (!designResult) return;
    setPhase('browser');
    setLogs([]);
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const ctx = buildConnectorContext(designResult);
      const values = await adapter.run(
        ctx,
        (entry) => setLogs((prev) => [...prev, entry]),
        ctrl.signal,
      );
      setExtractedValues(values);
      setPhase('review');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('consent');
        return;
      }
      setError(err instanceof Error ? err.message : 'Browser session failed');
      setPhase('error');
    }
  }, [designResult, adapter]);

  /** Cancel a running browser session */
  const cancelBrowser = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /** Update an extracted value before saving */
  const updateValue = useCallback((key: string, value: string) => {
    setExtractedValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Run healthcheck against extracted values */
  const runHealthcheck = useCallback(async () => {
    if (!designResult) return;
    setHealthResult(null);
    try {
      const result = await healthcheckPreview(designResult.connector.name, extractedValues);
      setHealthResult(result);
    } catch (err) {
      setHealthResult({ success: false, message: err instanceof Error ? err.message : 'Healthcheck failed' });
    }
  }, [designResult, extractedValues, healthcheckPreview]);

  /** Save the credential */
  const save = useCallback(async () => {
    if (!designResult) return;
    setIsSaving(true);
    setPhase('saving');
    try {
      await createCredential({
        name: credentialName.trim() || `${designResult.connector.label} Credential`,
        service_type: designResult.connector.name,
        data: extractedValues,
      });
      await fetchCredentials();
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
      setPhase('error');
    } finally {
      setIsSaving(false);
    }
  }, [designResult, credentialName, extractedValues, createCredential, fetchCredentials]);

  /** Reset entire session */
  const reset = useCallback(() => {
    cancelBrowser();
    setPhase('consent');
    setDesignResult(null);
    setLogs([]);
    setExtractedValues({});
    setCredentialName('');
    setError(null);
    setHealthResult(null);
    setIsSaving(false);
  }, [cancelBrowser]);

  return {
    phase,
    designResult,
    logs,
    extractedValues,
    credentialName,
    error,
    healthResult,
    isSaving,

    init,
    startBrowser,
    cancelBrowser,
    updateValue,
    setCredentialName,
    runHealthcheck,
    save,
    reset,
  };
}
