import { describe, it, expect, beforeEach, vi } from "vitest";
// Test needs per-call argument inspection, which the tauriMock helpers do not
// expose. Same escape hatch as `src/api/__tests__/settings.test.ts`.
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { getAppSettingCoalesced, BULK_READ_MAX_KEYS } from "../useSettings";
import { resetInvokeMocks } from "@/test/tauriMock";

// Set IPC token so invokeWithTimeout doesn't enter the token-wait loop.
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

const mockedInvoke = vi.mocked(invoke);

/** Every requested key echoes back as `<key>-v`, so a caller can prove which chunk answered it. */
function echoBulk() {
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd !== "get_app_settings_bulk") return undefined;
    const keys = (args as { keys: string[] }).keys;
    return Object.fromEntries(keys.map((k) => [k, `${k}-v`]));
  });
}

function bulkCalls() {
  return mockedInvoke.mock.calls.filter((c) => c[0] === "get_app_settings_bulk");
}

describe("settings read coalescer", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("collapses same-tick reads into one bulk invoke", async () => {
    echoBulk();

    const results = await Promise.all([
      getAppSettingCoalesced("a"),
      getAppSettingCoalesced("b"),
      getAppSettingCoalesced("a"),
    ]);

    expect(results).toEqual(["a-v", "b-v", "a-v"]);
    expect(bulkCalls()).toHaveLength(1);
    expect((bulkCalls()[0][1] as { keys: string[] }).keys).toEqual(["a", "b"]);
  });

  it("splits a batch larger than the backend's key ceiling", async () => {
    echoBulk();

    // The backend rejects the WHOLE call above GET_BATCH_MAX_KEYS
    // (AppError::Validation), which would reject every waiter in the batch.
    const keys = Array.from({ length: BULK_READ_MAX_KEYS + 40 }, (_, i) => `k${i}`);
    const values = await Promise.all(keys.map((k) => getAppSettingCoalesced(k)));

    expect(values).toEqual(keys.map((k) => `${k}-v`));

    const calls = bulkCalls();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect((call[1] as { keys: string[] }).keys.length).toBeLessThanOrEqual(
        BULK_READ_MAX_KEYS,
      );
    }
  });

  it("fails only the chunk that rejected, not the whole batch", async () => {
    const keys = Array.from({ length: BULK_READ_MAX_KEYS + 5 }, (_, i) => `k${i}`);
    // Reject whichever call carries the last key; resolve the other.
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "get_app_settings_bulk") return undefined;
      const chunk = (args as { keys: string[] }).keys;
      if (chunk.includes(keys[keys.length - 1])) throw new Error("boom");
      return Object.fromEntries(chunk.map((k) => [k, `${k}-v`]));
    });

    const settled = await Promise.allSettled(
      keys.map((k) => getAppSettingCoalesced(k)),
    );

    const rejected = settled.filter((s) => s.status === "rejected");
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    expect(rejected).toHaveLength(5);
    expect(fulfilled).toHaveLength(BULK_READ_MAX_KEYS);
  });
});
