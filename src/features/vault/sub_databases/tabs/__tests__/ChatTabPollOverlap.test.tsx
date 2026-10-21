import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ChatTab } from "../ChatTab";
import { trackInteraction } from "@/lib/sentry";
import { resetInvokeMocks } from "@/test/tauriMock";
import { __resetChatTranscriptsForTests } from "../chatTranscriptCache";

vi.mock("@/lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sentry")>()),
  trackInteraction: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedTrack = vi.mocked(trackInteraction);

/**
 * The 800 ms poll used to have no in-flight guard: a snapshot read slower than
 * the interval let a second tick start before the first settled, and both saw
 * "completed" -- two `generated` events and two bubble rewrites for one job.
 */
describe("ChatTab NL snapshot poll", () => {
  beforeEach(() => {
    __resetChatTranscriptsForTests();
    resetInvokeMocks();
    mockedTrack.mockClear();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
  });

  it("records one terminal event per job when the snapshot read is slower than the interval", async () => {
    let reads = 0;
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd !== "get_nl_query_snapshot") return undefined;
      reads += 1;
      await new Promise((r) => setTimeout(r, 2000));
      return { job_id: "job-1", status: "completed", error: null, lines: [], generated_sql: "SELECT 1", explanation: "ok" };
    });
    render(<ChatTab credentialId="cred-1" language="sql" serviceType="supabase" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "show me users" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });

    const generated = mockedTrack.mock.calls.filter((c) => c[0] === "db_nl_query" && c[1] === "generated");
    expect(generated).toHaveLength(1);
    expect(reads).toBeLessThan(3);
  });
});
