import { useState, useCallback, useRef, useMemo } from 'react';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { useVaultStore } from "@/stores/vaultStore";
import type {
  AutoCredPhase,
  BrowserLogEntry,
  ExtractedValues,
  AutoCredConnectorContext,
  AutoCredErrorInfo,
  ExtractionCompleteness,
  DiscoveredField,
  DiscoveredConnector,
} from './types';
import { buildConnectorContext, parseAutoCredError, checkFieldCompleteness } from './types';

/** Result returned by the adapter after a browser session. */
export interface AdapterResult {
  values: ExtractedValues;
  partial: boolean;
  /** Universal mode: dynamically discovered field definitions. */
  discoveredFields?: DiscoveredField[];
  /** Universal mode: auto-generated connector definition. */
  discoveredConnector?: DiscoveredConnector;
}

/**
 * Playwright MCP adapter interface.
 *
 * The hook talks to the Playwright MCP server via this adapter.
 * In production the browser session would be driven by:
 *   1. `playwright_navigate` -> docs_url or setup page
 *   2. `playwright_snapshot` -> read page
 *   3. `playwright_click` / `playwright_fill` -> interact
 *   4. `playwright_snapshot` -> extract created key
 *
 * The adapter is swappable: stub for development, real MCP for production.
 */
export interface PlaywrightAdapter {
  run(
    ctx: AutoCredConnectorContext,
    onLog: (entry: BrowserLogEntry) => void,
    signal: AbortSignal,
  ): Promise<AdapterResult>;
}

// -- Hook ----------------------------------------------------------------

interface UseAutoCredSessionOptions {
  adapter?: PlaywrightAdapter;
}

export function useAutoCredSession(options?: UseAutoCredSessionOptions) {
  const adapter = options?.adapter ?? null;
  const abortRef = useRef<AbortController | null>(null);

  const createCredential = useVaultStore((s) => s.createCredential);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const healthcheckPreview = useVaultStore((s) => s.healthcheckCredentialPreview);

  const [phase, setPhase] = useState<AutoCredPhase>('consent');
  const [designResult, setDesignResult] = useState<CredentialDesignResult | null>(null);
  const [logs, setLogs] = useState<BrowserLogEntry[]>([]);
  const [extractedValues, setExtractedValues] = useState<ExtractedValues>({});
  const [credentialName, setCredentialName] = useState('');
  const [error, setError] = useState<AutoCredErrorInfo | null>(null);
  const [isPartial, setIsPartial] = useState(false);
  const [healthResult, setHealthResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [discoveredFields, setDiscoveredFields] = useState<DiscoveredField[] | null>(null);
  const [discoveredConnector, setDiscoveredConnector] = useState<DiscoveredConnector | null>(null);

  /** Initialize a session from a design result */
  const init = useCallback((result: CredentialDesignResult) => {
    savingRef.current = false;
    setDesignResult(result);
    setPhase('consent');
    setLogs([]);
    setExtractedValues({});
    setCredentialName(`${result.connector.label} Credential`);
    setError(null);
    setIsPartial(false);
    setHealthResult(null);
    setIsSaving(false);
    setDiscoveredFields(null);
    setDiscoveredConnector(null);
  }, []);

  /** User consented -- start browser automation */
  const startBrowser = useCallback(async () => {
    if (!designResult) return;

    if (!adapter) {
      setError({
        kind: 'spawn_failed',
        message: 'No adapter configured',
        guidance: 'Auto-Setup requires the Playwright MCP adapter. Please set up credentials manually.',
        retryable: false,
        context: null,
      });
      setPhase('error');
      return;
    }

    setPhase('browser');
    setLogs([]);
    setError(null);
    setIsPartial(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const ctx = buildConnectorContext(designResult);
      const { values, partial, discoveredFields: df, discoveredConnector: dc } = await adapter.run(
        ctx,
        (entry) => setLogs((prev) => {
          // Deduplicate: skip if the last message is identical or a near-duplicate
          if (prev.length > 0) {
            const last = prev[prev.length - 1]!;
            const lastMsg = last.message.trim();
            const newMsg = entry.message.trim();
            // Exact duplicate
            if (lastMsg === newMsg && last.type === entry.type) return prev;
            // Near-duplicate: one is a prefix of the other (within 5 chars difference)
            if (last.type === entry.type && entry.type === 'action') {
              const shorter = lastMsg.length <= newMsg.length ? lastMsg : newMsg;
              const longer = lastMsg.length <= newMsg.length ? newMsg : lastMsg;
              if (longer.startsWith(shorter) && (longer.length - shorter.length) <= 5) {
                // Replace the last entry with the longer version
                return [...prev.slice(0, -1), { ...entry, message: longer }];
              }
            }
          }
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        }),
        ctrl.signal,
      );
      setExtractedValues(values);
      setIsPartial(partial);
      if (df) setDiscoveredFields(df);
      if (dc) setDiscoveredConnector(dc);
      setPhase('review');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('consent');
        return;
      }
      const raw = err instanceof Error ? err.message : 'Browser session failed';
      setError(parseAutoCredError(raw));
      // Stay in browser-error so the terminal log remains visible
      setPhase('browser-error');
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

  /**
   * Save the credential.
   *
   * Returns the new credential id + service_type + healthcheck outcome so the
   * caller can decide whether to open the post-save resource scope picker.
   */
  const save = useCallback(async (): Promise<{ id: string; serviceType: string; healthcheckPassed: boolean } | null> => {
    if (!designResult || savingRef.current) return null;
    savingRef.current = true;
    setIsSaving(true);
    setPhase('saving');
    try {
      const healthcheckPassed = healthResult?.success === true;
      const id = await createCredential({
        name: credentialName.trim() || `${designResult.connector.label} Credential`,
        service_type: designResult.connector.name,
        data: extractedValues,
        healthcheck_passed: healthcheckPassed,
      });
      await fetchCredentials();
      setPhase('done');
      return { id, serviceType: designResult.connector.name, healthcheckPassed };
    } catch (err) {
      setError(parseAutoCredError(err instanceof Error ? err.message : 'Failed to save credential'));
      setPhase('error');
      return null;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [designResult, credentialName, extractedValues, healthResult, createCredential, fetchCredentials]);

  /** Field-level completeness derived from extracted values and connector fields. */
  const completeness: ExtractionCompleteness | null = useMemo(() => {
    if (!designResult) return null;
    const ctx = buildConnectorContext(designResult);
    return checkFieldCompleteness(ctx.fields, extractedValues);
  }, [designResult, extractedValues]);

  /** Reset entire session */
  const reset = useCallback(() => {
    savingRef.current = false;
    cancelBrowser();
    setPhase('consent');
    setDesignResult(null);
    setLogs([]);
    setExtractedValues({});
    setCredentialName('');
    setError(null);
    setIsPartial(false);
    setHealthResult(null);
    setIsSaving(false);
    setDiscoveredFields(null);
    setDiscoveredConnector(null);
  }, [cancelBrowser]);

  return {
    phase,
    designResult,
    logs,
    extractedValues,
    credentialName,
    error,
    isPartial,
    completeness,
    healthResult,
    isSaving,
    discoveredFields,
    discoveredConnector,

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

export type AutoCredSessionReturn = ReturnType<typeof useAutoCredSession>;
