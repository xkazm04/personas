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

export interface CliSpecInfo {
  service_type: string;
  binary: string;
  display_label: string;
  install_hint: string;
  auth_instruction: string;
  docs_url: string;
}

export interface CliInstallStatus {
  service_type: string;
  installed: boolean;
  binary_path: string | null;
  version: string | null;
}

export interface CliVerifyResult {
  service_type: string;
  authenticated: boolean;
  identity: string | null;
  message: string;
}

export async function listCliSpecs(): Promise<CliSpecInfo[]> {
  return invoke<CliSpecInfo[]>("list_cli_specs");
}

export async function cliCheckInstalled(serviceType: string): Promise<CliInstallStatus> {
  return invoke<CliInstallStatus>("cli_check_installed", { serviceType });
}

export async function cliVerifyAuth(serviceType: string): Promise<CliVerifyResult> {
  return invoke<CliVerifyResult>("cli_verify_auth", { serviceType });
}
