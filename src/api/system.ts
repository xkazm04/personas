import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// System
// ============================================================================

export interface HealthCheckItem {
  id: string;
  label: string;
  status: string;
  detail: string | null;
  installable: boolean;
}

export interface HealthCheckSection {
  id: string;
  label: string;
  items: HealthCheckItem[];
}

export interface SystemHealthReport {
  sections: HealthCheckSection[];
  all_ok: boolean;
}

export const systemHealthCheck = () =>
  invoke<SystemHealthReport>("system_health_check");

export const openExternalUrl = (url: string) =>
  invoke<void>("open_external_url", { url });

// ============================================================================
// Crash Logs
// ============================================================================

export interface CrashLogEntry {
  filename: string;
  content: string;
}

export const getCrashLogs = () =>
  invoke<CrashLogEntry[]>("get_crash_logs");

export const clearCrashLogs = () =>
  invoke<void>("clear_crash_logs");

// ============================================================================
// Setup / Auto-install
// ============================================================================

export interface SetupStartResult {
  install_id: string;
}

export const startSetupInstall = (target: string) =>
  invoke<SetupStartResult>("start_setup_install", { target });

export const cancelSetupInstall = () =>
  invoke<void>("cancel_setup_install");
