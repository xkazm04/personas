import { listen } from '@tauri-apps/api/event';
import type { PlaywrightAdapter } from './useAutoCredSession';
import type { AutoCredConnectorContext, BrowserLogEntry, ExtractedValues } from './types';
import { startAutoCredBrowser, getPlaywrightProcedure, cancelAutoCredBrowser } from '@/api/vault/autoCredBrowser';
import { openExternalUrl } from '@/api/system/system';

/**
 * Tauri-backed PlaywrightAdapter.
 *
 * Calls the `start_auto_cred_browser` Tauri command which spawns Claude CLI
 * with the Playwright MCP server (or guided fallback). Progress events are
 * received via Tauri event listeners and forwarded to the onLog callback.
 *
 * Layer 2: Listens for `auto-cred-open-url` events and opens URLs in the
 * default browser automatically.
 *
 * Layer 3: Supports `force_guided` mode where Claude guides the user through
 * manual credential creation with clickable URLs.
 */
export class TauriPlaywrightAdapter implements PlaywrightAdapter {
  private forceGuided: boolean;

  constructor(options?: { forceGuided?: boolean }) {
    this.forceGuided = options?.forceGuided ?? false;
  }

  async run(
    ctx: AutoCredConnectorContext,
    onLog: (entry: BrowserLogEntry) => void,
    signal: AbortSignal,
  ): Promise<{ values: ExtractedValues; partial: boolean }> {
    const sessionId = crypto.randomUUID();

    // Check for saved procedure (only in playwright mode)
    let savedProcedure: string | undefined;
    if (!this.forceGuided) {
      try {
        const proc = await getPlaywrightProcedure(ctx.connector.name);
        if (proc?.procedure_json) {
          savedProcedure = proc.procedure_json;
          onLog({
            ts: Date.now(),
            message: `Using saved procedure for ${ctx.connector.label}`,
            type: 'info',
          });
        }
      } catch {
        // No saved procedure, that's fine
      }
    }

    // Set up event listener for progress
    const unlisten = await listen<{
      session_id: string;
      type: 'info' | 'action' | 'warning' | 'error' | 'url' | 'input_request';
      message: string;
      url?: string;
    }>('auto-cred-browser-progress', (event) => {
      if (event.payload.session_id !== sessionId) return;
      onLog({
        ts: Date.now(),
        message: event.payload.message,
        type: event.payload.type,
        url: event.payload.url,
      });
    });

    // Layer 2: Listen for URL open events and open in default browser
    const unlistenUrl = await listen<{
      session_id: string;
      url: string;
      auto_open?: boolean;
    }>('auto-cred-open-url', (event) => {
      if (event.payload.session_id !== sessionId) return;
      // auto_open defaults to true for OPEN_URL: protocol lines,
      // false for inline URL detections
      const autoOpen = event.payload.auto_open !== false;
      if (autoOpen) {
        openExternalUrl(event.payload.url).catch((err) => {
          console.error('Failed to open URL:', err);
          onLog({
            ts: Date.now(),
            message: `Failed to open URL: ${event.payload.url}`,
            type: 'error',
          });
        });
      }
    });

    // Handle abort — kill the subprocess and clean up listeners
    const abortHandler = () => {
      cancelAutoCredBrowser().catch(console.error);
      unlisten();
      unlistenUrl();
    };
    signal.addEventListener('abort', abortHandler, { once: true });

    try {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const result = await startAutoCredBrowser({
        session_id: sessionId,
        connector_name: ctx.connector.name,
        connector_label: ctx.connector.label,
        docs_url: ctx.docsUrl ?? undefined,
        setup_instructions: ctx.setupInstructions ?? undefined,
        fields: ctx.fields.map((f) => ({
          key: f.key,
          label: f.label,
          field_type: f.type ?? 'text',
          required: f.required ?? false,
          placeholder: f.placeholder,
          help_text: f.helpText,
        })),
        saved_procedure: savedProcedure,
        force_guided: this.forceGuided,
      });

      // Parse extracted values
      const values: ExtractedValues = {};
      if (result.extracted_values && typeof result.extracted_values === 'object') {
        for (const [key, val] of Object.entries(result.extracted_values)) {
          values[key] = String(val ?? '');
        }
      }

      // Store the procedure log for potential saving
      if (result.procedure_log) {
        (values as Record<string, string>).__procedure_log = result.procedure_log;
      }

      return { values, partial: result.partial ?? false };
    } finally {
      signal.removeEventListener('abort', abortHandler);
      unlisten();
      unlistenUrl();
    }
  }
}

/** Singleton adapter for Playwright mode (auto-detects availability) */
export const tauriPlaywrightAdapter = new TauriPlaywrightAdapter();

/** Singleton adapter for forced guided mode */
export const tauriGuidedAdapter = new TauriPlaywrightAdapter({ forceGuided: true });
