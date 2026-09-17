import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import en from "@/i18n/locales/en.json";
import { ChatTab } from "../ChatTab";
import { __resetChatTranscriptsForTests } from "../chatTranscriptCache";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * ConsoleTab keeps its last ten queries in a module cache so a tab switch does
 * not wipe the strip; Chat -- the lane that costs a model call per question --
 * held its transcript in component state and lost it on every remount. These
 * cases pin the three properties that make a remount cache safe: it comes
 * back, it does not leak across databases, and it never restores a bubble that
 * is still claiming to be generating.
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
    return undefined;
  });
}

async function ask(question: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: question } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("ChatTab transcript survives a remount", () => {
  beforeEach(() => {
    resetInvokeMocks();
    __resetChatTranscriptsForTests();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
    __resetChatTranscriptsForTests();
  });

  it("repaints the answer the user already paid for after a tab switch", async () => {
    mockChat("SELECT 1");
    const first = render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask("show me users");
    expect(screen.getByText("show me users")).toBeInTheDocument();

    // Leaving Chat for Tables unmounts the tab.
    await act(async () => { first.unmount(); });

    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    expect(screen.getByText("show me users")).toBeInTheDocument();
    expect(screen.getByText("Here you go.")).toBeInTheDocument();
  });

  it("keeps each database's transcript to itself", async () => {
    mockChat("SELECT 1");
    const first = render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    await ask("question for cred one");
    await act(async () => { first.unmount(); });

    render(<ChatTab credentialId="cred-2" language="sql" serviceType="supabase" />);
    expect(screen.queryByText("question for cred one")).not.toBeInTheDocument();
  });

  it("does not restore a bubble that is still claiming to generate", async () => {
    // A job that never resolves: unmount while it is still in flight.
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_nl_query") return undefined;
      if (cmd === "get_nl_query_snapshot") {
        return { job_id: "job-1", status: "running", error: null, lines: [], generated_sql: null, explanation: null };
      }
      return undefined;
    });
    const first = render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "slow question" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    await act(async () => { first.unmount(); });

    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    // The question is still there; the answer reads as cancelled, and the
    // composer is armed to Send rather than stuck offering Cancel.
    expect(screen.getByText("slow question")).toBeInTheDocument();
    expect(screen.getByText(en.vault.databases.cancelled)).toBeInTheDocument();
    expect(screen.getByLabelText(en.common.send)).toBeInTheDocument();
  });
});
