import { listen } from '@tauri-apps/api/event';
import type { PlaywrightAdapter } from './useAutoCredSession';
import type { AutoCredConnectorContext, BrowserLogEntry, ExtractedValues } from './types';
import { startAutoCredBrowser, getPlaywrightProcedure } from '@/api/autoCredBrowser';

/**
 * Tauri-backed PlaywrightAdapter.
 *
 * Calls the `start_auto_cred_browser` Tauri command which spawns Claude CLI
 * with the Playwright MCP server. Progress events are received via Tauri
 * event listeners and forwarded to the onLog callback.
 */
export class TauriPlaywrightAdapter implements PlaywrightAdapter {
  async run(
    ctx: AutoCredConnectorContext,
    onLog: (entry: BrowserLogEntry) => void,
    signal: AbortSignal,
  ): Promise<{ values: ExtractedValues; partial: boolean }> {
    const sessionId = crypto.randomUUID();

    // Check for saved procedure
    let savedProcedure: string | undefined;
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
      // intentional: non-critical -- no saved procedure available
    }

    // Set up event listener for progress
    const unlisten = await listen<{
      session_id: string;
      type: 'info' | 'action' | 'warning' | 'error';
      message: string;
    }>('auto-cred-browser-progress', (event) => {
      if (event.payload.session_id !== sessionId) return;
      onLog({
        ts: Date.now(),
        message: event.payload.message,
        type: event.payload.type,
      });
    });

    // Handle abort
    const abortHandler = () => {
      unlisten();
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
    }
  }
}

/** Singleton adapter instance */
export const tauriPlaywrightAdapter = new TauriPlaywrightAdapter();
