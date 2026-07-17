import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ChatTab } from "../tabs/ChatTab";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * Drives the AI-chat write path: the assistant proposes SQL, the user clicks
 * Run, and (for a mutation) the shared safe-mode confirm banner from the SQL
 * editor is offered before execution — proving mutations are runnable from chat
 * with the same confirm + write-mode semantics as the editor, and that reads
 * still execute directly.
 */
function mockChat(generatedSql: string) {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "start_nl_query") return undefined;
    if (cmd === "get_nl_query_snapshot") {
      return {
        job_id: "job-1",
        status: "completed",
        error: null,
        lines: [],
        generated_sql: generatedSql,
        explanation: "Here you go.",
      };
    }
    if (cmd === "execute_db_query") {
      return { columns: ["ok"], rows: [[1]], row_count: 1, duration_ms: 1 };
    }
    return undefined;
  });
}

async function askAndAwaitSql() {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "show me users" } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  // Poll interval is 800ms; advance until the assistant message resolves.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("ChatTab — AI mutation write path", () => {
  beforeEach(() => {
    resetInvokeMocks();
    // Satisfy the IPC-token gate in invokeWithTimeout so invoke() runs without
    // the 2s polling fallback (which would otherwise stall under fake timers).
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
  });

  it("offers the confirm banner for a mutation, then runs it in write mode", async () => {
    mockChat("DELETE FROM users WHERE id = 1");
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);

    await askAndAwaitSql();

    // Run the AI-suggested mutation.
    fireEvent.click(screen.getByTestId("chat-run-sql"));

    // The shared confirm banner appears; nothing has executed yet.
    expect(screen.getByTestId("db-mutation-confirm")).toBeInTheDocument();
    expect(
      mockedInvoke.mock.calls.some(([cmd]) => cmd === "execute_db_query"),
    ).toBe(false);

    // Confirm → executes with allowMutation = true.
    await act(async () => {
      fireEvent.click(screen.getByTestId("db-mutation-confirm-run"));
      await vi.advanceTimersByTimeAsync(0);
    });

    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === "execute_db_query");
    expect(call).toBeTruthy();
    expect((call![1] as { allowMutation?: boolean }).allowMutation).toBe(true);
  });

  it("runs a read query directly with no confirm banner", async () => {
    mockChat("SELECT * FROM users LIMIT 10");
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);

    await askAndAwaitSql();

    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-run-sql"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByTestId("db-mutation-confirm")).not.toBeInTheDocument();
    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === "execute_db_query");
    expect(call).toBeTruthy();
    expect((call![1] as { allowMutation?: boolean }).allowMutation).toBe(false);
  });
});
