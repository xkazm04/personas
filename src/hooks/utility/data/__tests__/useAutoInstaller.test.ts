import { describe, it, expect, beforeEach, vi } from "vitest";
// The event-driven state machine is the unit under test, so the test has to
// capture the handlers `listen()` is given. The tauriMock helpers only cover
// `invoke`; `listen` is mocked globally in `src/test/setup.ts`.
import { listen } from "@tauri-apps/api/event";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAutoInstaller } from "../useAutoInstaller";
import { EventName } from "@/lib/eventRegistry";
import { resetInvokeMocks } from "@/test/tauriMock";

// Set IPC token so invokeWithTimeout doesn't enter the token-wait loop.
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

const mockedListen = vi.mocked(listen);

type Handler = (event: { payload: unknown }) => void;

/**
 * Install a `listen` mock that records each event's handler and its unlisten,
 * so the test can drive the backend's event stream by hand.
 */
function captureListeners() {
  const handlers = new Map<string, Handler>();
  const unlistens: ReturnType<typeof vi.fn>[] = [];
  mockedListen.mockImplementation(async (event: string, handler: Handler) => {
    handlers.set(event, handler);
    const unlisten = vi.fn();
    unlistens.push(unlisten);
    return unlisten;
  });
  return {
    handlers,
    unlistens,
    emit(event: string, payload: unknown) {
      const h = handlers.get(event);
      if (!h) throw new Error(`no handler registered for ${event}`);
      act(() => { h({ payload }); });
    },
  };
}

describe("useAutoInstaller", () => {
  beforeEach(() => {
    resetInvokeMocks();
    mockedListen.mockReset();
  });

  it("starts idle", () => {
    captureListeners();
    const { result } = renderHook(() => useAutoInstaller());
    expect(result.current.nodeState).toEqual({
      phase: "idle", progressPct: 0, outputLines: [], error: null, manualCommand: null,
    });
    expect(result.current.claudeState.phase).toBe("idle");
  });

  it("drives one target through downloading -> installing -> completed", async () => {
    const bus = captureListeners();
    const { result } = renderHook(() => useAutoInstaller());

    await act(async () => { await result.current.install("node"); });
    expect(result.current.nodeState.phase).toBe("downloading");
    // The sibling target must not be dragged along.
    expect(result.current.claudeState.phase).toBe("idle");

    bus.emit(EventName.SETUP_STATUS, {
      install_id: "i-1", target: "node", status: "installing",
      progress_pct: 40, error: null, manual_command: null,
    });
    expect(result.current.nodeState.phase).toBe("installing");
    expect(result.current.nodeState.progressPct).toBe(40);

    bus.emit(EventName.SETUP_STATUS, {
      install_id: "i-1", target: "node", status: "completed",
      progress_pct: 100, error: null, manual_command: null,
    });
    expect(result.current.nodeState.phase).toBe("completed");
  });

  it("appends output lines in arrival order, per target", async () => {
    const bus = captureListeners();
    const { result } = renderHook(() => useAutoInstaller());
    await act(async () => { await result.current.install("all"); });

    bus.emit(EventName.SETUP_OUTPUT, { install_id: "i", target: "node", line: "one" });
    bus.emit(EventName.SETUP_OUTPUT, { install_id: "i", target: "claude_cli", line: "other" });
    bus.emit(EventName.SETUP_OUTPUT, { install_id: "i", target: "node", line: "two" });

    expect(result.current.nodeState.outputLines).toEqual(["one", "two"]);
    expect(result.current.claudeState.outputLines).toEqual(["other"]);
  });

  it("maps a status the InstallPhase union does not name (e.g. 'cancelled') to idle", async () => {
    const bus = captureListeners();
    const { result } = renderHook(() => useAutoInstaller());
    await act(async () => { await result.current.install("claude_cli"); });

    bus.emit(EventName.SETUP_STATUS, {
      install_id: "i", target: "claude_cli", status: "cancelled",
      progress_pct: null, error: null, manual_command: null,
    });
    // Parsed at the boundary rather than asserted into the union.
    expect(result.current.claudeState.phase).toBe("idle");
    // A null progress must not clobber the value already shown.
    expect(result.current.claudeState.progressPct).toBe(0);
  });

  it("carries error and manual command through a failed status", async () => {
    const bus = captureListeners();
    const { result } = renderHook(() => useAutoInstaller());
    await act(async () => { await result.current.install("node"); });

    bus.emit(EventName.SETUP_STATUS, {
      install_id: "i", target: "node", status: "failed",
      progress_pct: null, error: "boom", manual_command: "npm i -g node",
    });
    expect(result.current.nodeState).toMatchObject({
      phase: "failed", error: "boom", manualCommand: "npm i -g node",
    });
  });

  it("cancel unsubscribes and resets both targets", async () => {
    const bus = captureListeners();
    const { result } = renderHook(() => useAutoInstaller());
    await act(async () => { await result.current.install("all"); });
    expect(bus.unlistens).toHaveLength(2);

    act(() => { result.current.cancel(); });

    await waitFor(() => {
      for (const u of bus.unlistens) expect(u).toHaveBeenCalled();
    });
    expect(result.current.nodeState.phase).toBe("idle");
    expect(result.current.claudeState.phase).toBe("idle");
  });

  it("a second install tears down the first run's listeners", async () => {
    const bus = captureListeners();
    const { result } = renderHook(() => useAutoInstaller());

    await act(async () => { await result.current.install("node"); });
    const firstRun = [...bus.unlistens];
    await act(async () => { await result.current.install("node"); });

    for (const u of firstRun) expect(u).toHaveBeenCalled();
    expect(bus.unlistens).toHaveLength(4);
  });

  it("unsubscribes on unmount", async () => {
    const bus = captureListeners();
    const { result, unmount } = renderHook(() => useAutoInstaller());
    await act(async () => { await result.current.install("node"); });

    unmount();
    for (const u of bus.unlistens) expect(u).toHaveBeenCalled();
  });
});
