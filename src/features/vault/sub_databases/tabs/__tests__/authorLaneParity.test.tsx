import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ConsoleTab, __resetConsoleHistoryForTests } from "../ConsoleTab";
import { ChatTab } from "../ChatTab";
import { __resetChatTranscriptsForTests } from "../chatTranscriptCache";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * Three surfaces author SQL against one connector: the typed console, the
 * saved-query editor, and the NL chat lane. The saved-query editor carried
 * both the capability chip and a cancel; the console could not render the chip
 * (nothing passed it a serviceType) and chat could not cancel (its Run called
 * executeDbQuery with no execution id, so there was no handle to cancel WITH).
 * A connector's truth and a stop button should not depend on which of the
 * three the user happens to be standing in.
 */
describe("SQL author lanes -- capability chip and cancel parity", () => {
  beforeEach(() => {
    resetInvokeMocks();
    __resetConsoleHistoryForTests();
    __resetChatTranscriptsForTests();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
    __resetConsoleHistoryForTests();
    __resetChatTranscriptsForTests();
  });

  it("renders the backend-reported capability class in the console", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === "db_connector_capability" ? "key-value" : undefined,
    );

    await act(async () => {
      render(<ConsoleTab credentialId="cred-1" language="redis" serviceType="redis" />);
    });

    expect(await screen.findByTestId("db-capability-note")).toBeInTheDocument();
  });

  it("stays silent when no serviceType is supplied rather than guessing one", async () => {
    mockedInvoke.mockImplementation(async () => undefined);
    await act(async () => {
      render(<ConsoleTab credentialId="cred-1" language="sql" />);
    });
    expect(screen.queryByTestId("db-capability-note")).not.toBeInTheDocument();
  });

  it("cancels a running chat statement at the engine, not just in the UI", async () => {
    vi.useFakeTimers();
    try {
      // The generation completes; the execution then hangs, which is the case
      // a stop button exists for.
      let releaseQuery: (() => void) | undefined;
      mockedInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "start_nl_query") return undefined;
        if (cmd === "get_nl_query_snapshot") {
          return {
            job_id: "job-1",
            status: "completed",
            error: null,
            lines: [],
            generated_sql: "SELECT * FROM huge_table",
            explanation: "Here you go.",
          };
        }
        if (cmd === "execute_db_query") {
          return new Promise((resolve) => { releaseQuery = () => resolve({ columns: [], rows: [], row_count: 0, duration_ms: 1 }); });
        }
        return undefined;
      });

      render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "everything please" } });
      await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

      await act(async () => {
        fireEvent.click(screen.getByTestId("chat-run-sql"));
        await vi.advanceTimersByTimeAsync(0);
      });

      // The run carries an execution id -- the handle cancellation needs.
      const run = mockedInvoke.mock.calls.find(([cmd]) => cmd === "execute_db_query");
      expect(run).toBeTruthy();
      expect((run![1] as { queryId?: string }).queryId).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByTestId("chat-cancel-sql"));
        await vi.advanceTimersByTimeAsync(0);
      });

      const cancel = mockedInvoke.mock.calls.find(([cmd]) => cmd === "cancel_db_query");
      expect(cancel).toBeTruthy();
      expect((cancel![1] as { queryId?: string }).queryId).toBe((run![1] as { queryId?: string }).queryId);

      releaseQuery?.();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally {
      vi.useRealTimers();
    }
  });
});
