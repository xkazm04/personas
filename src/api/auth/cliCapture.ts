import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface CliCaptureResult {
  service_type: string;
  fields: Record<string, string>;
  token_ttl_seconds: number | null;
  captured_at: string;
  expires_at: string | null;
}

export async function listCliCapturableServices(): Promise<string[]> {
  return invoke<string[]>("list_cli_capturable_services");
}

export async function cliCaptureRun(serviceType: string): Promise<CliCaptureResult> {
  return invoke<CliCaptureResult>("cli_capture_run", { serviceType });
}

export async function refreshCredentialCliNow(credentialId: string): Promise<string> {
  return invoke<string>("refresh_credential_cli_now", { credentialId });
}
