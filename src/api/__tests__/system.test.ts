import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  systemHealthCheck,
  healthCheckLocal,
  healthCheckAgents,
  healthCheckCloud,
  openExternalUrl,
  getCrashLogs,
  clearCrashLogs,
  reportFrontendCrash,
  getFrontendCrashes,
  clearFrontendCrashes,
  getFrontendCrashCount,
  startSetupInstall,
  cancelSetupInstall,
  sendAppNotification,
} from "@/api/system/system";

describe("api/system/system", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("systemHealthCheck returns report", async () => {
    const report = { overall: "healthy", sections: [] };
    mockInvoke("system_health_check", report);
    expect(await systemHealthCheck()).toEqual(report);
  });

  it("healthCheckLocal returns section", async () => {
    mockInvoke("health_check_local", { name: "local", items: [] });
    expect(await healthCheckLocal()).toEqual({ name: "local", items: [] });
  });

  it("healthCheckAgents returns section", async () => {
    mockInvoke("health_check_agents", { name: "agents", items: [] });
    expect(await healthCheckAgents()).toEqual({ name: "agents", items: [] });
  });

  it("healthCheckCloud returns section", async () => {
    mockInvoke("health_check_cloud", { name: "cloud", items: [] });
    expect(await healthCheckCloud()).toEqual({ name: "cloud", items: [] });
  });

  it("openExternalUrl calls open_external_url", async () => {
    mockInvoke("open_external_url", undefined);
    await expect(openExternalUrl("https://example.com")).resolves.toBeUndefined();
  });

  it("getCrashLogs returns entries", async () => {
    mockInvoke("get_crash_logs", []);
    expect(await getCrashLogs()).toEqual([]);
  });

  it("clearCrashLogs resolves", async () => {
    mockInvoke("clear_crash_logs", undefined);
    await expect(clearCrashLogs()).resolves.toBeUndefined();
  });

  it("reportFrontendCrash returns row", async () => {
    const row = { id: "fc-1", component: "App" };
    mockInvoke("report_frontend_crash", row);
    const result = await reportFrontendCrash("App", "oops", "stack");
    expect(result).toEqual(row);
  });

  it("getFrontendCrashes returns entries with limit", async () => {
    mockInvoke("get_frontend_crashes", []);
    expect(await getFrontendCrashes(10)).toEqual([]);
  });

  it("clearFrontendCrashes resolves", async () => {
    mockInvoke("clear_frontend_crashes", undefined);
    await expect(clearFrontendCrashes()).resolves.toBeUndefined();
  });

  it("getFrontendCrashCount returns number", async () => {
    mockInvoke("get_frontend_crash_count", 3);
    expect(await getFrontendCrashCount(24)).toBe(3);
  });

  it("startSetupInstall returns result", async () => {
    mockInvoke("start_setup_install", { started: true });
    expect(await startSetupInstall("ollama")).toEqual({ started: true });
  });

  it("cancelSetupInstall resolves", async () => {
    mockInvoke("cancel_setup_install", undefined);
    await expect(cancelSetupInstall()).resolves.toBeUndefined();
  });

  it("sendAppNotification resolves", async () => {
    mockInvoke("send_app_notification", undefined);
    await expect(sendAppNotification("Title", "Body")).resolves.toBeUndefined();
  });

  it("rejects on backend error", async () => {
    mockInvokeError("system_health_check", "service down");
    await expect(systemHealthCheck()).rejects.toThrow("service down");
  });
});
