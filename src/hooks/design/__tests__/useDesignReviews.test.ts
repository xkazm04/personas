import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDesignReviews } from "../template/useDesignReviews";
import { mockInvokeMap, resetInvokeMocks } from "@/test/tauriMock";
import { clearSWRCache } from "@/lib/utils/staleWhileRevalidate";

// Set IPC token so invokeWithTimeout doesn't enter infinite token-wait loop
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

async function invokedCommands(): Promise<string[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return vi.mocked(invoke).mock.calls.map((c) => c[0] as string);
}

describe("useDesignReviews", () => {
  beforeEach(() => {
    resetInvokeMocks();
    clearSWRCache();
  });

  it("reports the TRUE total from the count query", async () => {
    mockInvokeMap({ count_design_reviews: 124 });

    const { result } = renderHook(() => useDesignReviews());

    // The first mount in this file pays the seed-catalog import
    // (getSeedReviews() dynamically imports the whole template JSON glob),
    // which can exceed waitFor's 1s default under a loaded full-suite run.
    await waitFor(
      () => {
        expect(result.current.totalCount).toBe(124);
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 10_000 },
    );
    expect(result.current.error).toBeNull();
  });

  it("does not fetch review rows nobody reads", async () => {
    // The page header reads only the count. The hook used to pull a capped
    // page of up to 50 full rows twice per mount (before and after the seed).
    mockInvokeMap({ count_design_reviews: 3 });

    const { result } = renderHook(() => useDesignReviews());
    await waitFor(() => expect(result.current.totalCount).toBe(3), { timeout: 10_000 });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const commands = await invokedCommands();
    expect(commands.filter((c) => c === "list_design_reviews")).toHaveLength(0);
    expect(commands).toContain("count_design_reviews");
  });

  it("does not claim a total before the count query answers", async () => {
    mockInvokeMap({ count_design_reviews: 0 });

    const { result } = renderHook(() => useDesignReviews());

    // `null`, never 0 — "not known yet" must be distinguishable from "none",
    // or the header flashes a confident wrong number on every cold load.
    expect(result.current.totalCount).toBeNull();

    await waitFor(() => {
      expect(result.current.totalCount).toBe(0);
    });
  });

  it("shows the message of an IPC AppError rejection, not a fixed fallback", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "count_design_reviews") return Promise.reject({ error: "Database is locked", kind: "Database" });
      return Promise.resolve(undefined as never);
    });

    const { result } = renderHook(() => useDesignReviews());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Database is locked");
    expect(result.current.totalCount).toBeNull();
  });

  it("refresh recounts and clears a previous error", async () => {
    mockInvokeMap({ count_design_reviews: 5 });
    const { result } = renderHook(() => useDesignReviews());
    await waitFor(() => expect(result.current.totalCount).toBe(5));

    mockInvokeMap({ count_design_reviews: 6 });
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.totalCount).toBe(6);
    expect(result.current.error).toBeNull();
  });
});
