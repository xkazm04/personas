import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { LangfuseAdminCredentials } from "@/lib/bindings/LangfuseAdminCredentials";
import type { LangfuseConfig } from "@/lib/bindings/LangfuseConfig";
import type { LangfuseJobHandle } from "@/lib/bindings/LangfuseJobHandle";
import type { LangfuseSaveRequest } from "@/lib/bindings/LangfuseSaveRequest";
import type { LangfuseStackInfo } from "@/lib/bindings/LangfuseStackInfo";
import type { LangfuseTestResult } from "@/lib/bindings/LangfuseTestResult";

// ---------------------------------------------------------------------------
// Manual connection (advanced flow)
// ---------------------------------------------------------------------------

export async function langfuseTestConnection(
  host: string,
  publicKey: string,
  secretKey: string,
): Promise<LangfuseTestResult> {
  return invoke<LangfuseTestResult>("langfuse_test_connection", {
    host,
    publicKey,
    secretKey,
  });
}

export async function langfuseSaveConfig(
  request: LangfuseSaveRequest,
): Promise<LangfuseTestResult> {
  return invoke<LangfuseTestResult>("langfuse_save_config", { request });
}

export async function langfuseGetConfig(): Promise<LangfuseConfig | null> {
  return invoke<LangfuseConfig | null>("langfuse_get_config");
}

export async function langfuseClearConfig(): Promise<void> {
  return invoke<void>("langfuse_clear_config");
}

export async function langfuseSavePreferredPort(port: number): Promise<number> {
  return invoke<number>("langfuse_save_preferred_port", { port });
}

// ---------------------------------------------------------------------------
// Managed self-host stack — Phase 1c is non-blocking: start/stop/install
// return a job handle and progress flows on Tauri events.
// ---------------------------------------------------------------------------

export async function langfuseStackGetInfo(): Promise<LangfuseStackInfo> {
  return invoke<LangfuseStackInfo>("langfuse_stack_get_info");
}

export async function langfuseStackStart(): Promise<LangfuseJobHandle> {
  return invoke<LangfuseJobHandle>("langfuse_stack_start");
}

export async function langfuseStackStop(): Promise<LangfuseJobHandle> {
  return invoke<LangfuseJobHandle>("langfuse_stack_stop");
}

export async function langfuseStackGetAdminCredentials(): Promise<LangfuseAdminCredentials | null> {
  return invoke<LangfuseAdminCredentials | null>(
    "langfuse_stack_get_admin_credentials",
  );
}

export async function langfuseStackOpenUI(): Promise<void> {
  return invoke<void>("langfuse_stack_open_ui");
}

/// Open the user's default browser at the in-app auto-login shim. The shim
/// signs the user in via NextAuth's credentials provider, then redirects
/// to either the dashboard or the path passed via `returnTo`.
///
/// Falls back to the plain open-in-browser path for manual connections
/// (no admin creds in keyring).
export async function langfuseOpenAuthenticatedUI(returnTo?: string): Promise<void> {
  return invoke<void>("langfuse_open_authenticated_ui", { returnTo: returnTo ?? null });
}

export async function langfuseDockerDownloadInstaller(): Promise<LangfuseJobHandle> {
  return invoke<LangfuseJobHandle>("langfuse_docker_download_installer");
}

export async function langfuseDockerRunInstaller(path: string): Promise<void> {
  return invoke<void>("langfuse_docker_run_installer", { path });
}

/// Reset all stack data via `compose down -v`. Destructive; UI must confirm.
export async function langfuseStackReset(): Promise<void> {
  return invoke<void>("langfuse_stack_reset", undefined, {
    timeoutMs: 60_000,
  });
}

/// Pull latest images. Restart needed for them to take effect.
export async function langfuseStackRefreshImages(): Promise<void> {
  return invoke<void>("langfuse_stack_refresh_images", undefined, {
    timeoutMs: 10 * 60_000,
  });
}
