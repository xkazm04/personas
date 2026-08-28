import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../useSettings";
import { mockInvokeMap, mockedTauriInvoke, resetInvokeMocks } from "@/test/tauriMock";
import { _clearAutoDedupForTests } from "@/lib/tauriInvoke";

// Set IPC token so invokeWithTimeout doesn't enter the token-wait loop.
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

type ChangedCb = (event: { payload: { key: string } }) => void;

describe("useSettings — Direction 3 live refresh", () => {
  beforeEach(() => {
    resetInvokeMocks();
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockResolvedValue(() => {});
  });

  it("refetches when a settings-changed event names a subscribed key", async () => {
    // Capture the listener the hook registers so we can drive it manually.
    let captured: ChangedCb | null = null;
    vi.mocked(listen).mockImplementation((name: string, cb: unknown) => {
      if (name === "settings-changed") captured = cb as ChangedCb;
      return Promise.resolve(() => {});
    });

    // A mutable backing store — the same object ref is returned on every
    // bulk read, so mutating it changes what the next refetch observes.
    const store: Record<string, string | null> = { cli_engine: "v1" };
    mockInvokeMap({ get_app_settings_bulk: store });

    const { result } = renderHook(() => useSettings(["cli_engine"]));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.values.cli_engine).toBe("v1");
    expect(captured).toBeTypeOf("function");

    // Simulate another panel writing the key. Bust the 250ms read auto-dedup so
    // the refetch actually re-invokes rather than replaying the cached result.
    store.cli_engine = "v2";
    _clearAutoDedupForTests();
    await act(async () => {
      captured!({ payload: { key: "cli_engine" } });
    });

    await waitFor(() => expect(result.current.values.cli_engine).toBe("v2"));
  });

  it("ignores settings-changed events for unsubscribed keys", async () => {
    let captured: ChangedCb | null = null;
    vi.mocked(listen).mockImplementation((name: string, cb: unknown) => {
      if (name === "settings-changed") captured = cb as ChangedCb;
      return Promise.resolve(() => {});
    });

    const store: Record<string, string | null> = { cli_engine: "v1" };
    mockInvokeMap({ get_app_settings_bulk: store });

    const { result } = renderHook(() => useSettings(["cli_engine"]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.values.cli_engine).toBe("v1");

    // Change the backing value and bust the dedup: a refetch WOULD now see v2.
    store.cli_engine = "v2";
    _clearAutoDedupForTests();
    await act(async () => {
      captured!({ payload: { key: "some_other_key" } });
    });

    // The value stays v1 — proving the unsubscribed key did not trigger a refetch.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.values.cli_engine).toBe("v1");
  });
});

describe('useSettings -- the key list is not a delimiter round-trip', () => {
  beforeEach(() => {
    resetInvokeMocks();
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockResolvedValue(() => {});
  });

  it('sends a key containing the internal separator as ONE key', async () => {
    // Callers already build dynamic keys; a fragment carrying U+001F used to
    // be split back into two keys that do not exist.
    const weird = `execution_retention_months:p-1\x1fsuffix`;
    mockInvokeMap({ get_app_settings_bulk: { [weird]: '12' } });

    const { result } = renderHook(() => useSettings([weird]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const call = vi.mocked(mockedTauriInvoke).mock.calls.find(
      (c) => c[0] === 'get_app_settings_bulk',
    );
    expect(call).toBeDefined();
    expect((call![1] as { keys: string[] }).keys).toEqual([weird]);
    expect(result.current.values[weird]).toBe('12');
  });
});
