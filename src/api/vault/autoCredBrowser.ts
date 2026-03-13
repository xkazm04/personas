import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AutoCredField } from "@/lib/bindings/AutoCredField";
import type { AutoCredBrowserRequest } from "@/lib/bindings/AutoCredBrowserRequest";
import type { AutoCredBrowserResult } from "@/lib/bindings/AutoCredBrowserResult";
export type { AutoCredField, AutoCredBrowserRequest, AutoCredBrowserResult };

/** IPC timeout for browser sessions -- 10 minutes to allow manual sign-in steps. */
const BROWSER_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

export async function startAutoCredBrowser(request: AutoCredBrowserRequest): Promise<AutoCredBrowserResult> {
  return invoke<AutoCredBrowserResult>('start_auto_cred_browser', { request }, undefined, BROWSER_SESSION_TIMEOUT_MS);
}

export async function savePlaywrightProcedure(
  connectorName: string,
  procedureJson: string,
  fieldKeys: string,
): Promise<{ id: string; connector_name: string; is_active: boolean }> {
  return invoke('save_playwright_procedure', {
    connectorName,
    procedureJson,
    fieldKeys,
  });
}

export async function checkPlaywrightAvailable(): Promise<boolean> {
  return invoke<boolean>('check_auto_cred_playwright_available');
}

export async function cancelAutoCredBrowser(): Promise<void> {
  return invoke<void>('cancel_auto_cred_browser');
}

export async function getPlaywrightProcedure(
  connectorName: string,
): Promise<{
  id: string;
  connector_name: string;
  procedure_json: string;
  field_keys: string;
  is_active: boolean;
  created_at: string;
} | null> {
  return invoke('get_playwright_procedure', { connectorName });
}
