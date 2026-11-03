// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeError, mockedTauriInvoke, resetInvokeMocks } from "@/test/tauriMock";
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
  startSetupInstall,
  cancelSetupInstall,
  sendAppNotification,
} from "@/api/system/system";

/**
 * The payload the wrapper put on the wire. A pass-through return assertion
 * cannot see a renamed key (`componentStack` -> `component_stack`), and a key
 * the Rust handler does not recognise arrives as `None` without an error, so
 * payload-bearing wrappers pin their args against the Rust parameter names.
 */
function lastPayload(): unknown {
  return mockedTauriInvoke.mock.calls.at(-1)?.[1];
}

/**
 * The command the wrapper actually sent. A void wrapper's test cannot pin it
 * through the return: an unmatched command also resolves `undefined`.
 */
function lastCommand(): unknown {
  return mockedTauriInvoke.mock.calls.at(-1)?.[0];
}

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
    expect(lastCommand()).toBe("open_external_url");
    expect(lastPayload()).toEqual({ url: "https://example.com" });
  });

  it("getCrashLogs returns entries", async () => {
    mockInvoke("get_crash_logs", []);
    expect(await getCrashLogs()).toEqual([]);
  });

  it("clearCrashLogs resolves", async () => {
    mockInvoke("clear_crash_logs", undefined);
    await expect(clearCrashLogs()).resolves.toBeUndefined();
    expect(lastCommand()).toBe("clear_crash_logs");
  });

  it("reportFrontendCrash returns row", async () => {
    const row = { id: "fc-1", component: "App" };
    mockInvoke("report_frontend_crash", row);
    const result = await reportFrontendCrash("App", "oops", "stack");
    expect(result).toEqual(row);
    // crash_telemetry.rs report_frontend_crash(component, message, stack, component_stack)
    expect(lastPayload()).toEqual({ component: "App", message: "oops", stack: "stack", componentStack: null });
  });

  it("getFrontendCrashes returns entries with limit", async () => {
    mockInvoke("get_frontend_crashes", []);
    expect(await getFrontendCrashes(10)).toEqual([]);
    expect(lastPayload()).toEqual({ limit: 10 });
  });

  it("clearFrontendCrashes resolves", async () => {
    mockInvoke("clear_frontend_crashes", undefined);
    await expect(clearFrontendCrashes()).resolves.toBeUndefined();
    expect(lastCommand()).toBe("clear_frontend_crashes");
  });

  it("startSetupInstall returns result", async () => {
    mockInvoke("start_setup_install", { started: true });
    expect(await startSetupInstall("ollama")).toEqual({ started: true });
    expect(lastPayload()).toEqual({ target: "ollama" });
  });

  it("cancelSetupInstall resolves", async () => {
    mockInvoke("cancel_setup_install", undefined);
    await expect(cancelSetupInstall()).resolves.toBeUndefined();
    expect(lastCommand()).toBe("cancel_setup_install");
  });

  it("sendAppNotification resolves", async () => {
    mockInvoke("send_app_notification", undefined);
    await expect(sendAppNotification("Title", "Body")).resolves.toBeUndefined();
    expect(lastCommand()).toBe("send_app_notification");
    expect(lastPayload()).toEqual({ title: "Title", body: "Body" });
  });

  it("rejects on backend error", async () => {
    mockInvokeError("system_health_check", "service down");
    await expect(systemHealthCheck()).rejects.toThrow("service down");
  });
});
