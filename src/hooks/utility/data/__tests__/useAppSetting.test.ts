import { describe, it, expect, beforeEach, vi } from "vitest";
// Test needs per-call argument inspection and a deferred resolution, which the
// tauriMock helpers do not expose. Same escape hatch as
// `src/api/__tests__/settings.test.ts`.
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAppSetting } from "../useAppSetting";
import { resetInvokeMocks } from "@/test/tauriMock";

// Set IPC token so invokeWithTimeout doesn't enter the token-wait loop.
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

const mockedInvoke = vi.mocked(invoke);

function bulkCalls() {
  return mockedInvoke.mock.calls.filter((c) => c[0] === "get_app_settings_bulk");
}

describe("useAppSetting", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("loads the stored value for its key", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "get_app_settings_bulk") return undefined;
      const keys = (args as { keys: string[] }).keys;
      return Object.fromEntries(keys.map((k) => [k, k === "alpha" ? "A" : null]));
    });

    const { result } = renderHook(() => useAppSetting("alpha", "fallback"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.value).toBe("A");
  });

  it("does not read at all for an empty key", async () => {
    mockedInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppSetting("", "fallback"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.value).toBe("fallback");
    expect(bulkCalls()).toHaveLength(0);
  });

  it("clears the previous key's value while the new key loads", async () => {
    let releaseSecond: (() => void) | null = null;
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "get_app_settings_bulk") return undefined;
      const keys = (args as { keys: string[] }).keys;
      if (keys.includes("beta")) {
        await new Promise<void>((res) => { releaseSecond = res; });
        return { beta: "B" };
      }
      return { alpha: "A" };
    });

    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useAppSetting(k, "fallback"),
      { initialProps: { k: "alpha" } },
    );
    await waitFor(() => expect(result.current.value).toBe("A"));

    rerender({ k: "beta" });

    // The previous key's value must not sit on screen labelled as loaded.
    await waitFor(() => expect(result.current.loaded).toBe(false));
    expect(result.current.value).toBe("fallback");

    await act(async () => {
      releaseSecond?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.value).toBe("B"));
    expect(result.current.loaded).toBe(true);
  });

  it("drops a late response for a superseded key", async () => {
    let releaseFirst: (() => void) | null = null;
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "get_app_settings_bulk") return undefined;
      const keys = (args as { keys: string[] }).keys;
      if (keys.includes("alpha")) {
        await new Promise<void>((res) => { releaseFirst = res; });
        return { alpha: "STALE" };
      }
      return { beta: "B" };
    });

    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useAppSetting(k, "fallback"),
      { initialProps: { k: "alpha" } },
    );
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));

    rerender({ k: "beta" });
    await waitFor(() => expect(result.current.value).toBe("B"));

    // 'alpha' answers only now — it belongs to a superseded key.
    await act(async () => {
      releaseFirst?.();
      await Promise.resolve();
    });
    expect(result.current.value).toBe("B");
  });
});
