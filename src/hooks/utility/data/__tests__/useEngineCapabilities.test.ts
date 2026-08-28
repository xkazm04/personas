import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// The tests need per-call argument inspection (which key was written, with
// what payload), which the tauriMock helpers do not expose. Same escape hatch
// as `useAppSetting.test.ts`.
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEngineCapabilities } from "../useEngineCapabilities";
import { CAPABILITY_SETTING_KEY } from "@/features/settings/sub_engine/libs/engineCapabilities";
import { resetInvokeMocks } from "@/test/tauriMock";

// Set IPC token so invokeWithTimeout doesn't enter the token-wait loop.
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

const mockedInvoke = vi.mocked(invoke);

/** Mock the two reads the hook issues on mount. `stored` is the raw string. */
function mockLoad(stored: string | null) {
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "get_app_settings_bulk") {
      const keys = (args as { keys: string[] }).keys;
      return Object.fromEntries(
        keys.map((k) => [k, k === CAPABILITY_SETTING_KEY ? stored : null]),
      );
    }
    if (cmd === "health_check_local") return { items: [] };
    return undefined;
  });
}

function writes() {
  return mockedInvoke.mock.calls.filter((c) => c[0] === "set_app_setting");
}

describe("useEngineCapabilities", () => {
  beforeEach(() => {
    resetInvokeMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("merges a valid stored map over the defaults", async () => {
    mockLoad(JSON.stringify({ design_analysis: { claude_code: false } }));
    const { result } = renderHook(() => useEngineCapabilities());

    await waitFor(() => { expect(result.current.loaded).toBe(true); });
    expect(result.current.capabilities.design_analysis.claude_code).toBe(false);
    // An operation the stored map never mentioned keeps its default.
    expect(result.current.capabilities.persona_execution.claude_code).toBe(true);
  });

  it("REFUSES to persist a toggle after a corrupt load", async () => {
    mockLoad("{ this is not json");
    const { result } = renderHook(() => useEngineCapabilities());

    await waitFor(() => { expect(result.current.loaded).toBe(true); });
    // Parse failed, so the map stays at the permissive defaults.
    expect(result.current.capabilities.persona_execution.claude_code).toBe(true);

    act(() => { result.current.toggle("persona_execution", "claude_code"); });
    act(() => { vi.advanceTimersByTime(1000); });

    // This is the guard the finding says nothing tested: writing here would
    // overwrite the operator's real-but-unreadable map with "everything on".
    expect(writes()).toHaveLength(0);
    expect(result.current.capabilities.persona_execution.claude_code).toBe(false);
  });

  it("an explicit resetToDefaults clears the corrupt-load guard and writes", async () => {
    mockLoad("{ this is not json");
    const { result } = renderHook(() => useEngineCapabilities());
    await waitFor(() => { expect(result.current.loaded).toBe(true); });

    act(() => { result.current.resetToDefaults(); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toMatchObject({ key: CAPABILITY_SETTING_KEY });

    // And once cleared, ordinary toggles persist again.
    act(() => { result.current.toggle("persona_execution", "claude_code"); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(writes()).toHaveLength(2);
  });

  it("toggles persist exactly once and compose within a tick", async () => {
    mockLoad(null);
    const { result } = renderHook(() => useEngineCapabilities());
    await waitFor(() => { expect(result.current.loaded).toBe(true); });

    act(() => {
      // Two different operations flipped back to back. The debounce collapses
      // them into one write, whose payload must carry BOTH flips — it does
      // not if `next` is derived from a stale copy.
      result.current.toggle("persona_execution", "claude_code");
      result.current.toggle("design_analysis", "claude_code");
    });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(writes()).toHaveLength(1);
    const payload = JSON.parse((writes()[0][1] as { value: string }).value);
    expect(payload.persona_execution.claude_code).toBe(false);
    expect(payload.design_analysis.claude_code).toBe(false);
  });
});
