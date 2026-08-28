import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const checkMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.2.3"),
}));

import {
  useAutoUpdater,
  resetAutoUpdaterForTests,
  autoUpdaterSubscriberCountForTests,
} from "../useAutoUpdater";

describe("useAutoUpdater", () => {
  beforeEach(() => {
    checkMock.mockReset();
    checkMock.mockResolvedValue(null);
    resetAutoUpdaterForTests();
  });

  afterEach(() => { resetAutoUpdaterForTests(); });

  it("shares one state across every consumer", async () => {
    checkMock.mockResolvedValue({ version: "9.9.9", body: "notes" });

    const banner = renderHook(() => useAutoUpdater());
    const settings = renderHook(() => useAutoUpdater());

    // A manual check driven from one consumer (Settings) must be visible to
    // the other (the banner) — per-instance state made this impossible.
    await act(async () => {
      await settings.result.current.checkForUpdate();
    });

    expect(banner.result.current.updateAvailable).toBe(true);
    expect(banner.result.current.updateInfo).toEqual({ version: "9.9.9", body: "notes" });
    expect(settings.result.current.updateAvailable).toBe(true);
    expect(banner.result.current.lastChecked).toBe(settings.result.current.lastChecked);

    act(() => { banner.result.current.dismissUpdate(); });
    expect(settings.result.current.updateAvailable).toBe(false);

    banner.unmount();
    settings.unmount();
  });

  it("runs one check when two consumers race, reporting the loser honestly", async () => {
    let release: (v: unknown) => void = () => {};
    checkMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const a = renderHook(() => useAutoUpdater());
    const b = renderHook(() => useAutoUpdater());

    let first: Promise<string> | undefined;
    let second: string | undefined;
    await act(async () => {
      first = a.result.current.checkForUpdate();
      second = await b.result.current.checkForUpdate();
      release(null);
      await first;
    });

    expect(second).toBe("already-checking");
    expect(checkMock).toHaveBeenCalledTimes(1);

    a.unmount();
    b.unmount();
  });

  it("refcounts the poller: acquired on first mount, released on last unmount", () => {
    expect(autoUpdaterSubscriberCountForTests()).toBe(0);

    const a = renderHook(() => useAutoUpdater());
    const b = renderHook(() => useAutoUpdater());
    expect(autoUpdaterSubscriberCountForTests()).toBe(2);

    a.unmount();
    expect(autoUpdaterSubscriberCountForTests()).toBe(1);
    b.unmount();
    expect(autoUpdaterSubscriberCountForTests()).toBe(0);
  });
});
