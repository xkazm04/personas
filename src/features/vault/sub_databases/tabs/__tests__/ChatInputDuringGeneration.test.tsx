import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ChatTab } from "../ChatTab";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * The textarea used to carry `disabled={generating}`, which locked it for the
 * whole generation window (up to 60s), dropped focus to <body>, and dropped
 * every keystroke of the follow-up the user was drafting. The double-submit
 * guard already lives in ChatTab's handleSubmit, so the lock only ever cost
 * drafting time.
 */
describe("ChatTab — drafting during generation", () => {
  beforeEach(() => {
    resetInvokeMocks();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
    vi.useFakeTimers();
    // Never terminal: keeps `generating` true for the whole test.
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === "get_nl_query_snapshot"
        ? { job_id: "job-1", status: "running", error: null, lines: [], generated_sql: null, explanation: null }
        : undefined,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
  });

  async function askAndStayGenerating() {
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "show me users" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    return input;
  }

  it("leaves the textarea editable while a generation is in flight", async () => {
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    const input = await askAndStayGenerating();

    // The control beside it is in its Cancel state, i.e. we really are generating.
    expect(screen.getAllByLabelText(/cancel/i).length).toBeGreaterThan(0);
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: "and their last login" } });
    expect(input.value).toBe("and their last login");
  });

  it("ignores Enter during generation without discarding the draft", async () => {
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    const input = await askAndStayGenerating();

    fireEvent.change(input, { target: { value: "and their last login" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(0);
    });

    // The submit guard swallowed it — the draft is still there, not blanked.
    expect(input.value).toBe("and their last login");
    const starts = mockedInvoke.mock.calls.filter((c) => c[0] === "start_nl_query");
    expect(starts).toHaveLength(1);
  });
});
