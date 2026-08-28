import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ChatTab } from "../ChatTab";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * Two read-back guarantees the chat lane owes the user, neither of which the
 * write-path suite covers:
 *
 *  1. An answer that carries no SQL (a clarifying question, a refusal) must
 *     still be readable — it used to render a completely empty bubble.
 *  2. A failed re-run must not leave the previous run's rows on screen under
 *     the error, which reads as "this error produced that data".
 */
function mockChat(opts: {
  generatedSql: string;
  explanation: string;
  execute?: () => unknown;
}) {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "start_nl_query") return undefined;
    if (cmd === "get_nl_query_snapshot") {
      return {
        job_id: "job-1",
        status: "completed",
        error: null,
        lines: [],
        generated_sql: opts.generatedSql,
        explanation: opts.explanation,
      };
    }
    if (cmd === "execute_db_query") return opts.execute?.();
    return undefined;
  });
}

async function ask() {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "show me users" } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("ChatTab — assistant message rendering", () => {
  beforeEach(() => {
    resetInvokeMocks();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
  });

  it("renders an answer that carries no SQL instead of an empty bubble", async () => {
    mockChat({ generatedSql: "", explanation: "Which users do you mean?" });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);

    await ask();

    expect(screen.getByText("Which users do you mean?")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-run-sql")).not.toBeInTheDocument();
  });

  it("drops the previous rows when a re-run fails", async () => {
    let call = 0;
    mockChat({
      generatedSql: "SELECT * FROM users LIMIT 1",
      explanation: "Here you go.",
      execute: () => {
        call += 1;
        if (call === 1) {
          return { columns: ["email"], rows: [["ada@example.com"]], row_count: 1, duration_ms: 1 };
        }
        throw new Error("relation \"users\" does not exist");
      },
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);

    await ask();

    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-run-sql"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-run-sql"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText(/does not exist/)).toBeInTheDocument();
    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
  });

  it("advertises the connector's capability class, like the saved-query toolbar does", async () => {
    // The chat lane offers Run on every connector. On a key-value or
    // introspection-only one the generated statement cannot execute at all, and
    // this lane used to carry no capability chrome whatsoever.
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === "db_connector_capability" ? "key-value" : undefined,
    );
    render(<ChatTab credentialId="cred-1" language="redis" serviceType="upstash" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("db-capability-note")).toHaveAttribute("data-capability", "key-value");
  });
});
