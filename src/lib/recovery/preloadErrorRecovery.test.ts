import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THROTTLE_MS,
  RELOAD_KEY,
  installPreloadErrorRecovery,
} from "./preloadErrorRecovery";

// Empirical verification for the WebView2 preload-error recovery path
// (C6 §Open #2). The actual WebView2 + tauri-cli rebuild scenario is
// observed live; these tests pin the listener's behavior so future edits
// can't quietly regress the throttle, the reload call, or preventDefault.

function makeStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    key(i: number) {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k: string) {
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
    removeItem(k: string) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
  return storage;
}

function makeLogger() {
  return { error: vi.fn() };
}

describe("installPreloadErrorRecovery", () => {
  let target: EventTarget;
  let detach: (event: Event) => void;

  beforeEach(() => {
    target = new EventTarget();
  });

  afterEach(() => {
    if (detach) target.removeEventListener("vite:preloadError", detach);
  });

  it("calls reload, sets storage marker, and preventDefaults the event on first fire", () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const logger = makeLogger();
    const now = vi.fn(() => 1_000_000);
    detach = installPreloadErrorRecovery({
      target,
      storage,
      reload,
      logger,
      now,
    });

    const evt = new Event("vite:preloadError", { cancelable: true });
    const preventSpy = vi.spyOn(evt, "preventDefault");
    target.dispatchEvent(evt);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(preventSpy).toHaveBeenCalledTimes(1);
    expect(storage.getItem(RELOAD_KEY)).toBe("1000000");
    expect(logger.error).toHaveBeenCalledWith(
      "vite:preloadError — reloading to pick up fresh chunks",
      expect.any(Object),
    );
  });

  it("does NOT reload when fired again within the throttle window", () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const logger = makeLogger();
    let t = 1_000_000;
    detach = installPreloadErrorRecovery({
      target,
      storage,
      reload,
      logger,
      now: () => t,
    });

    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);

    // Second dispatch only DEFAULT_THROTTLE_MS - 1 ms later → no reload
    t += DEFAULT_THROTTLE_MS - 1;
    target.dispatchEvent(new Event("vite:preloadError"));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenLastCalledWith(
      "vite:preloadError repeated within throttle — letting it surface",
      expect.any(Object),
    );
  });

  it("DOES reload on a second fire after the throttle window has elapsed", () => {
    const storage = makeStorage();
    const reload = vi.fn();
    let t = 1_000_000;
    detach = installPreloadErrorRecovery({
      target,
      storage,
      reload,
      logger: makeLogger(),
      now: () => t,
    });

    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);

    // Move past the throttle window
    t += DEFAULT_THROTTLE_MS + 1;
    target.dispatchEvent(new Event("vite:preloadError"));

    expect(reload).toHaveBeenCalledTimes(2);
    expect(storage.getItem(RELOAD_KEY)).toBe(String(t));
  });

  it("treats a missing storage marker as 'never reloaded' and reloads on first fire", () => {
    const storage = makeStorage();
    storage.removeItem(RELOAD_KEY);
    const reload = vi.fn();
    // now() must be ≥ throttleMs so the absent-marker case (lastReloadAt=0)
    // is outside the throttle window. Production uses Date.now() which is
    // always huge, so this is realistic.
    detach = installPreloadErrorRecovery({
      target,
      storage,
      reload,
      logger: makeLogger(),
      now: () => DEFAULT_THROTTLE_MS + 1,
    });

    target.dispatchEvent(new Event("vite:preloadError"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("respects a caller-supplied custom throttle", () => {
    const storage = makeStorage();
    const reload = vi.fn();
    // Start above the custom throttle so the absent-marker (lastReloadAt=0)
    // case doesn't itself trip the throttle on the first dispatch.
    let t = 100_000;
    detach = installPreloadErrorRecovery({
      target,
      storage,
      reload,
      logger: makeLogger(),
      now: () => t,
      throttleMs: 5_000,
    });

    target.dispatchEvent(new Event("vite:preloadError"));
    t += 4_999;
    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);

    t += 2; // total since first reload: 5_001 ms
    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("propagates the event's `message` field into the log payload", () => {
    const logger = makeLogger();
    detach = installPreloadErrorRecovery({
      target,
      storage: makeStorage(),
      reload: vi.fn(),
      logger,
      now: () => DEFAULT_THROTTLE_MS + 1,
    });

    const evt = new Event("vite:preloadError") as Event & { message?: string };
    evt.message = "Failed to fetch chunk-XYZ.js";
    target.dispatchEvent(evt);

    expect(logger.error).toHaveBeenCalledWith(
      "vite:preloadError — reloading to pick up fresh chunks",
      { message: "Failed to fetch chunk-XYZ.js" },
    );
  });
});
