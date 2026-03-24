import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { HealthCheckItem } from "@/lib/bindings/HealthCheckItem";
import type { HealthCheckSection } from "@/lib/bindings/HealthCheckSection";
import type { SystemHealthReport } from "@/lib/bindings/SystemHealthReport";
import type { CrashLogEntry } from "@/lib/bindings/CrashLogEntry";
import type { FrontendCrashRow } from "@/lib/bindings/FrontendCrashRow";
import type { SetupStartResult } from "@/lib/bindings/SetupStartResult";
export type { HealthCheckItem, HealthCheckSection, SystemHealthReport, CrashLogEntry, FrontendCrashRow, SetupStartResult };

export const systemHealthCheck = () =>
  invoke<SystemHealthReport>("system_health_check");

// Per-section health checks for cascade loading
export const healthCheckLocal = () =>
  invoke<HealthCheckSection>("health_check_local");
export const healthCheckAgents = () =>
  invoke<HealthCheckSection>("health_check_agents");
export const healthCheckCloud = () =>
  invoke<HealthCheckSection>("health_check_cloud");
export const healthCheckAccount = () =>
  invoke<HealthCheckSection>("health_check_account");
export const healthCheckCircuitBreaker = () =>
  invoke<HealthCheckSection>("health_check_circuit_breaker");
export const healthCheckSubscriptions = () =>
  invoke<HealthCheckSection>("health_check_subscriptions");

export const openExternalUrl = (url: string) =>
  invoke<void>("open_external_url", { url });

// Claude Desktop MCP integration
export const registerClaudeDesktopMcp = () =>
  invoke<string>("register_claude_desktop_mcp");
export const unregisterClaudeDesktopMcp = () =>
  invoke<string>("unregister_claude_desktop_mcp");
export const checkClaudeDesktopMcp = () =>
  invoke<boolean>("check_claude_desktop_mcp");

// ============================================================================
// Crash Logs
// ============================================================================

export const getCrashLogs = () =>
  invoke<CrashLogEntry[]>("get_crash_logs");

export const clearCrashLogs = () =>
  invoke<void>("clear_crash_logs");

// ============================================================================
// Frontend Crash Telemetry (SQLite-persisted)
// ============================================================================

export const reportFrontendCrash = (
  component: string,
  message: string,
  stack?: string | null,
  componentStack?: string | null,
) =>
  invoke<FrontendCrashRow>("report_frontend_crash", {
    component,
    message,
    stack: stack ?? null,
    componentStack: componentStack ?? null,
  });

export const getFrontendCrashes = (limit?: number) =>
  invoke<FrontendCrashRow[]>("get_frontend_crashes", { limit: limit ?? null });

export const clearFrontendCrashes = () =>
  invoke<void>("clear_frontend_crashes");

export const getFrontendCrashCount = (hours?: number) =>
  invoke<number>("get_frontend_crash_count", { hours: hours ?? null });

// ============================================================================
// Setup / Auto-install
// ============================================================================

export const startSetupInstall = (target: string) =>
  invoke<SetupStartResult>("start_setup_install", { target });

export const cancelSetupInstall = () =>
  invoke<void>("cancel_setup_install");

// ============================================================================
// Notifications
// ============================================================================

export const sendAppNotification = (title: string, body: string) =>
  invoke<void>("send_app_notification", { title, body });
