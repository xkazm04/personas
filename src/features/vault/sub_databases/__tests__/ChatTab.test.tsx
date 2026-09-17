import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ChatTab } from "../tabs/ChatTab";
import { resetInvokeMocks } from "@/test/tauriMock";
import { __resetChatTranscriptsForTests } from "../tabs/chatTranscriptCache";

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
    // The transcript cache is module-scoped and survives a remount by design,
    // so it also survives a test; a stale transcript repaints in the next one.
    __resetChatTranscriptsForTests();
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

/**
 * The failure half of the NL lane.
 *
 * The suite above drives the happy write path only, so the three ways a
 * generation can end badly were unpinned: the 60s poll timeout, the cancel a
 * tab-switch is supposed to fire, and a snapshot read that keeps throwing. All
 * three share one consequence -- `generating` is the double-submit guard, and
 * a job that never resolves holds it forever while the bubble spins. A hung
 * job must read as a failure, never as a successful empty answer.
 */
describe("ChatTab -- generation failure paths", () => {
  beforeEach(() => {
    // The transcript cache is module-scoped and survives a remount by design,
    // so it also survives a test; a stale transcript repaints in the next one.
    __resetChatTranscriptsForTests();
    resetInvokeMocks();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
  });

  /** A backend job that never leaves `running` -- a crash, or a dropped job. */
  function mockStuckJob() {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_nl_query") return undefined;
      if (cmd === "get_nl_query_snapshot") {
        return { job_id: "job-1", status: "running", error: null, lines: [], generated_sql: null, explanation: null };
      }
      return undefined;
    });
  }

  async function ask() {
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "show me users" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
  }

  /**
   * Cancel calls are counted as a DELTA, never as "has it ever been called".
   * The previous test's teardown unmounts its ChatTab, which legitimately
   * fires its own cancel, and that call can land in this test's recorded
   * history -- an absolute assertion reads it as this component's doing.
   */
  function cancelCount() {
    return mockedInvoke.mock.calls.filter(([cmd]) => cmd === "cancel_nl_query").length;
  }

  it("fails the message and cancels the job once the poll times out", async () => {
    mockStuckJob();
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    const before = cancelCount();

    // Still generating at 59s: the timeout must not fire early.
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(screen.queryByText(en.vault.databases.query_timeout)).not.toBeInTheDocument();
    expect(cancelCount()).toBe(before);

    // Past NL_QUERY_POLL_TIMEOUT_MS the bubble resolves to the timeout copy and
    // the backend job is cancelled rather than left spending model budget.
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.getByText(en.vault.databases.query_timeout)).toBeInTheDocument();
    expect(cancelCount()).toBe(before + 1);
  });

  it("releases the generating guard when the poll times out", async () => {
    mockStuckJob();
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    // While generating the composer's control is Cancel, so no Send exists.
    expect(screen.queryByLabelText(en.common.send)).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(62_000); });

    // Guard released: a follow-up question can be asked again.
    expect(screen.getByLabelText(en.common.send)).toBeInTheDocument();
  });

  it("cancels the in-flight job when the tab unmounts mid-generation", async () => {
    mockStuckJob();
    const { unmount } = render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    const before = cancelCount();

    await act(async () => { unmount(); });

    // Leaving the tab must stop the spend, not just stop the polling.
    expect(cancelCount()).toBe(before + 1);
  });

  it("does not hold the guard forever when every snapshot read throws", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_nl_query") return undefined;
      if (cmd === "get_nl_query_snapshot") throw new Error("ipc exploded");
      return undefined;
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    // The poll swallows the read error and retries; the timeout is the only
    // thing that ends it, so it has to actually end it.
    await act(async () => { await vi.advanceTimersByTimeAsync(62_000); });

    expect(screen.getByText(en.vault.databases.query_timeout)).toBeInTheDocument();
    expect(screen.getByLabelText(en.common.send)).toBeInTheDocument();
  });
});
