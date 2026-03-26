import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { mockInvoke, mockInvokeMap, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listExecutions,
  listAllExecutions,
  getExecution,
  cancelExecution,
  executePersona,
  getExecutionLog,
  getExecutionLogLines,
  getExecutionTrace,
  getCircuitBreakerStatus,
} from "@/api/agents/executions";

const mockedInvoke = vi.mocked(invoke);

describe("api/agents/executions", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listExecutions calls list_executions with personaId", async () => {
    mockInvoke("list_executions", [{ id: "e-1" }]);
    const result = await listExecutions("p-1", 10);
    expect(result).toEqual([{ id: "e-1" }]);
    expect(mockedInvoke).toHaveBeenCalledWith(
      "list_executions",
      expect.objectContaining({ personaId: "p-1", limit: 10 }),
      undefined,
    );
  });

  it("listAllExecutions calls list_all_executions", async () => {
    mockInvoke("list_all_executions", []);
    const result = await listAllExecutions(5, "completed");
    expect(result).toEqual([]);
  });

  it("getExecution calls get_execution", async () => {
    const exec = { id: "e-1", status: "completed" };
    mockInvoke("get_execution", exec);
    const result = await getExecution("e-1", "p-1");
    expect(result).toEqual(exec);
  });

  it("cancelExecution calls cancel_execution", async () => {
    mockInvoke("cancel_execution", undefined);
    await expect(cancelExecution("e-1", "p-1")).resolves.toBeUndefined();
  });

  it("executePersona calls execute_persona", async () => {
    const exec = { id: "e-new", status: "running" };
    mockInvoke("execute_persona", exec);
    const result = await executePersona("p-1", "t-1", '{"key":"val"}');
    expect(result).toEqual(exec);
  });

  it("getExecutionLog returns log string", async () => {
    mockInvoke("get_execution_log", "line1\nline2");
    const result = await getExecutionLog("e-1", "p-1");
    expect(result).toBe("line1\nline2");
  });

  it("getExecutionLogLines returns string array", async () => {
    mockInvoke("get_execution_log_lines", ["line1", "line2"]);
    const result = await getExecutionLogLines("e-1", "p-1");
    expect(result).toEqual(["line1", "line2"]);
  });

  it("getExecutionTrace returns trace or null", async () => {
    mockInvoke("get_execution_trace", null);
    const result = await getExecutionTrace("e-1", "p-1");
    expect(result).toBeNull();
  });

  it("getCircuitBreakerStatus returns status", async () => {
    const status = { state: "closed", failure_count: 0 };
    mockInvoke("get_circuit_breaker_status", status);
    const result = await getCircuitBreakerStatus();
    expect(result).toEqual(status);
  });

  it("rejects when backend errors", async () => {
    mockInvokeError("list_executions", "db connection failed");
    await expect(listExecutions("p-1")).rejects.toThrow("db connection failed");
  });
});
