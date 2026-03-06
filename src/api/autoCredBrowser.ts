import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface AutoCredField {
  key: string;
  label: string;
  field_type: string;
  required: boolean;
  placeholder?: string;
  help_text?: string;
}

export interface AutoCredBrowserRequest {
  session_id: string;
  connector_name: string;
  connector_label: string;
  docs_url?: string;
  setup_instructions?: string;
  fields: AutoCredField[];
  saved_procedure?: string;
  force_guided?: boolean;
}

export interface AutoCredBrowserResult {
  session_id: string;
  extracted_values: Record<string, string>;
  procedure_log: string;
  partial: boolean;
}

export async function startAutoCredBrowser(request: AutoCredBrowserRequest): Promise<AutoCredBrowserResult> {
  return invoke<AutoCredBrowserResult>('start_auto_cred_browser', { request });
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
