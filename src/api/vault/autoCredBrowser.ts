import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AutoCredField } from "@/lib/bindings/AutoCredField";
import type { AutoCredBrowserRequest } from "@/lib/bindings/AutoCredBrowserRequest";
import type { AutoCredBrowserResult } from "@/lib/bindings/AutoCredBrowserResult";
export type { AutoCredField, AutoCredBrowserRequest, AutoCredBrowserResult };

/**
 * IPC timeout for browser sessions. Kept 1 min ABOVE the backend's 10-minute
 * hard process timeout (`BROWSER_TIMEOUT_SECS`) so the backend always times out,
 * kills the CLI + Chromium, and returns a clean error first — the frontend IPC
 * timeout is only a last-resort backstop and must not fire before the backend
 * has had its chance to kill the process (which would orphan a live CLI).
 */
const BROWSER_SESSION_TIMEOUT_MS = 11 * 60 * 1000;

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
