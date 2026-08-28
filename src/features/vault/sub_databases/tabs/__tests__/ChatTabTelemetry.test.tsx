import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ChatTab } from "../ChatTab";
import { trackInteraction } from "@/lib/sentry";
import { resetInvokeMocks } from "@/test/tauriMock";

vi.mock("@/lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sentry")>()),
  trackInteraction: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedTrack = vi.mocked(trackInteraction);

/**
 * The NL lane costs a model call per question and, until these events existed,
 * produced no signal at all about whether that spend pays off: generation,
 * failure, the 60s timeout and — the one that actually matters — whether the
 * generated statement was ever RUN all lived and died in component state.
 *
 * These assertions also pin the privacy shape: the label vocabulary is a fixed
 * enumeration, never the question or the generated SQL.
 */
function actionsFor(category = "db_nl_query") {
  return mockedTrack.mock.calls.filter((c) => c[0] === category).map((c) => c[1]);
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

describe("ChatTab — NL-query outcome telemetry", () => {
  beforeEach(() => {
    resetInvokeMocks();
    mockedTrack.mockClear();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
  });

  function mockSnapshot(snapshot: Record<string, unknown>, execute?: () => unknown) {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_nl_query_snapshot") return snapshot;
      if (cmd === "execute_db_query") return execute?.();
      return undefined;
    });
  }

  it("records a completed generation and whether it carried SQL", async () => {
    mockSnapshot({
      job_id: "job-1", status: "completed", error: null, lines: [],
      generated_sql: "SELECT 1", explanation: "Here you go.",
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    expect(actionsFor()).toContain("generated");
    expect(mockedTrack).toHaveBeenCalledWith("db_nl_query", "generated", "with_sql");
  });

  it("distinguishes an answer with no SQL from one that carries a statement", async () => {
    mockSnapshot({
      job_id: "job-1", status: "completed", error: null, lines: [],
      generated_sql: "", explanation: "Which users?",
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    expect(mockedTrack).toHaveBeenCalledWith("db_nl_query", "generated", "no_sql");
  });

  it("records a failed generation", async () => {
    mockSnapshot({
      job_id: "job-1", status: "failed", error: "model unavailable", lines: [],
      generated_sql: null, explanation: null,
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    expect(actionsFor()).toContain("generation_failed");
  });

  it("records the 60s timeout, which previously left no trace anywhere", async () => {
    mockSnapshot({
      job_id: "job-1", status: "running", error: null, lines: [],
      generated_sql: null, explanation: null,
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    expect(actionsFor()).not.toContain("generation_timeout");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(actionsFor()).toContain("generation_timeout");
  });

  it("records that the generated statement was actually run, and as which kind", async () => {
    mockSnapshot(
      {
        job_id: "job-1", status: "completed", error: null, lines: [],
        generated_sql: "SELECT * FROM users", explanation: "Here you go.",
      },
      () => ({ columns: ["ok"], rows: [[1]], row_count: 1, duration_ms: 1 }),
    );
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-run-sql"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockedTrack).toHaveBeenCalledWith("db_nl_query", "executed", "read");
  });

  /**
   * The confirm banner sits BETWEEN "generated" and "executed", and used to be
   * the one step in the funnel that emitted nothing: a model-written DELETE the
   * user refused looked exactly like a question they never ran.
   */
  async function askForADelete() {
    mockSnapshot(
      {
        job_id: "job-1", status: "completed", error: null, lines: [],
        generated_sql: "DELETE FROM users", explanation: "This removes them.",
      },
      () => ({ columns: ["ok"], rows: [[1]], row_count: 1, duration_ms: 1 }),
    );
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();
    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-run-sql"));
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("records that the user REFUSED a generated mutation at the confirm banner", async () => {
    await askForADelete();
    expect(screen.getByTestId("db-mutation-confirm")).toBeTruthy();
    expect(actionsFor()).not.toContain("mutation_cancelled");

    await act(async () => {
      fireEvent.click(screen.getByTestId("db-mutation-confirm-cancel"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(actionsFor()).toContain("mutation_cancelled");
    // The refusal must stay distinguishable from a run that happened.
    expect(actionsFor()).not.toContain("executed");
  });

  it("records that the user AUTHORISED a generated mutation", async () => {
    await askForADelete();
    await act(async () => {
      fireEvent.click(screen.getByTestId("db-mutation-confirm-run"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(actionsFor()).toContain("mutation_confirmed");
    expect(mockedTrack).toHaveBeenCalledWith("db_nl_query", "executed", "mutation");
  });

  it("never puts the question or the generated SQL into a telemetry label", async () => {
    mockSnapshot({
      job_id: "job-1", status: "completed", error: null, lines: [],
      generated_sql: "SELECT secret FROM users", explanation: "Here you go.",
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask();

    const labels = mockedTrack.mock.calls.map((c) => c[2]).filter(Boolean) as string[];
    for (const label of labels) {
      expect(["with_sql", "no_sql", "read", "mutation", "start"]).toContain(label);
    }
  });
});
