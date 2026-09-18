import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';
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

// -- Resumable session ---------------------------------------------------

/**
 * What a harvest leaves behind when its panel unmounts.
 *
 * Navigating away from the wizard -- a sidebar click, a route change -- used to
 * be an implicit discard: `init` always reset the phase to `consent` and
 * cleared `extractedValues`, so a ten-minute browser session that had already
 * pulled two of three fields was thrown away with no record that consent had
 * ever been given. Coming back re-asked for consent and re-ran the browser.
 *
 * ONLY SETTLED, POST-BROWSER PHASES ARE KEPT. An interrupted `browser` phase
 * stores nothing: the panel's unmount cleanup kills Chromium, so there is no
 * result to resume and restoring that phase would paint a live session that is
 * not running. A remount mid-browser therefore lands back on consent, which is
 * also what stops the wizard from silently relaunching a browser nobody asked
 * for a second time.
 */
interface AutoCredResumeState {
  phase: Extract<AutoCredPhase, 'review' | 'browser-error' | 'error'>;
  extractedValues: ExtractedValues;
  logs: BrowserLogEntry[];
  credentialName: string;
  isPartial: boolean;
  error: AutoCredErrorInfo | null;
  discoveredFields: DiscoveredField[] | null;
  discoveredConnector: DiscoveredConnector | null;
  consentedAt: number;
}

function isResumablePhase(phase: AutoCredPhase): phase is AutoCredResumeState['phase'] {
  return phase === 'review' || phase === 'browser-error' || phase === 'error';
}

/**
 * Keyed by connector name, so two connectors in flight do not overwrite each
 * other.
 *
 * SECRET CUSTODY: entries hold harvested field values, so the cap and the TTL
 * are the point, not housekeeping. Nothing here is written to disk (a module
 * cache is renderer heap and dies with the window), and an entry is dropped the
 * moment it stops being useful -- on a successful save and on an explicit
 * discard. The TTL bounds the case where the user does neither.
 */
const RESUME_TTL_MS = 30 * 60_000;
const resumeCache = createModuleCache<string, AutoCredResumeState>({
  ttlMs: RESUME_TTL_MS,
  maxSize: 4,
});

/** Test seam: drop every resumable session (no production caller). */
export function clearAutoCredResumeCache(): void {
  resumeCache.clear();
}

// -- Hook ----------------------------------------------------------------

interface UseAutoCredSessionOptions {
  adapter?: PlaywrightAdapter;
}

export function useAutoCredSession(options?: UseAutoCredSessionOptions) {
  const { t, tx } = useTranslation();
  const ace = t.vault.auto_cred_extra;
  const credentialSuffix = t.vault.credential_forms.credential_suffix;
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

  /**
   * Initialize a session from a design result, resuming one this connector
   * left behind rather than silently discarding it.
   */
  const init = useCallback((result: CredentialDesignResult) => {
    savingRef.current = false;
    setDesignResult(result);
    setHealthResult(null);
    setIsSaving(false);

    const resumed = resumeCache.get(result.connector.name);
    if (resumed) {
      setPhase(resumed.phase);
      setLogs(resumed.logs);
      setExtractedValues(resumed.extractedValues);
      setCredentialName(resumed.credentialName);
      setError(resumed.error);
      setIsPartial(resumed.isPartial);
      setDiscoveredFields(resumed.discoveredFields);
      setDiscoveredConnector(resumed.discoveredConnector);
      return;
    }

    setPhase('consent');
    setLogs([]);
    setExtractedValues({});
    setCredentialName(tx(credentialSuffix, { name: result.connector.label }));
    setError(null);
    setIsPartial(false);
    setDiscoveredFields(null);
    setDiscoveredConnector(null);
  }, [tx, credentialSuffix]);

  // Record the session whenever it reaches a phase worth coming back to. The
  // healthcheck result is deliberately NOT carried across: it is a live claim
  // about this moment, and re-running it is cheap.
  useEffect(() => {
    const connectorName = designResult?.connector.name;
    if (!connectorName || !isResumablePhase(phase)) return;
    resumeCache.set(connectorName, {
      phase,
      extractedValues,
      logs,
      credentialName,
      isPartial,
      error,
      discoveredFields,
      discoveredConnector,
      consentedAt: Date.now(),
    });
  }, [
    phase, designResult, extractedValues, logs, credentialName, isPartial, error,
    discoveredFields, discoveredConnector,
  ]);

  /** User consented -- start browser automation */
  const startBrowser = useCallback(async () => {
    if (!designResult) return;

    if (!adapter) {
      setError({
        kind: 'spawn_failed',
        message: ace.err_no_adapter,
        guidance: ace.err_no_adapter_hint,
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
      // `err` may be the structured AppError envelope (auto_cred_browser
      // commands migrated to `Result<_, AppError>`), a plain `Error`, or a
      // raw string -- `parseAutoCredError` handles all three via `isTauriError`.
      setError(parseAutoCredError(err, t));
      // Stay in browser-error so the terminal log remains visible
      setPhase('browser-error');
    }
  }, [designResult, adapter, ace.err_no_adapter, ace.err_no_adapter_hint, t]);

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
      setHealthResult({ success: false, message: err instanceof Error ? err.message : ace.err_healthcheck_failed });
    }
  }, [ace.err_healthcheck_failed, designResult, extractedValues, healthcheckPreview]);

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
      // Strip transport-only keys (e.g. `__procedure_log`, smuggled in by the
      // adapter for the dev-only "save procedure" button) before persisting --
      // they aren't credential secrets and shouldn't be written into the
      // encrypted data blob.
      const persistableValues = Object.fromEntries(
        Object.entries(extractedValues).filter(([key]) => !key.startsWith('__')),
      );
      const id = await createCredential({
        name: credentialName.trim() || tx(credentialSuffix, { name: designResult.connector.label }),
        service_type: designResult.connector.name,
        data: persistableValues,
        healthcheck_passed: healthcheckPassed,
      });
      await fetchCredentials();
      // The values are now in the encrypted vault; the plaintext copy has no
      // remaining purpose, so it does not wait out the TTL.
      resumeCache.delete(designResult.connector.name);
      setPhase('done');
      return { id, serviceType: designResult.connector.name, healthcheckPassed };
    } catch (err) {
      setError(parseAutoCredError(err, t, ace.err_save_failed));
      setPhase('error');
      return null;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [designResult, healthResult?.success, createCredential, credentialName, tx, credentialSuffix, extractedValues, fetchCredentials, ace.err_save_failed, t]);

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
    // An explicit discard is a decision, unlike an unmount -- forget the
    // harvest rather than offering it back on the next visit.
    if (designResult) resumeCache.delete(designResult.connector.name);
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
  }, [cancelBrowser, designResult]);

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
