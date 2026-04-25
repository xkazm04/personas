// -- Trailing-debounce wrapper around localStorage for zustand/persist ---
//
// Zustand's `persist` middleware writes to localStorage synchronously on every
// `setState`. Hot stores (matrixBuildSlice, executionSlice, …) call setState
// many times per second during runs — the resulting JSON.stringify +
// localStorage.setItem bursts block the main thread on Windows WebView2.
//
// This adapter coalesces writes per key with a trailing debounce (250 ms by
// default) and registers a one-shot flush on pagehide / beforeunload so
// in-flight writes still hit disk before the window closes. Reads return the
// buffered value first so the persisted snapshot the user just produced is
// never read back as stale.

const DEFAULT_DEBOUNCE_MS = 300;

interface PendingWrite {
  value: string;
  timer: ReturnType<typeof setTimeout>;
}

const pendingByKey = new Map<string, PendingWrite>();
let _flushHookInstalled = false;

function installFlushHook(): void {
  if (_flushHookInstalled) return;
  if (typeof window === "undefined") return;
  _flushHookInstalled = true;

  const flushAll = () => {
    for (const [key, pending] of pendingByKey) {
      clearTimeout(pending.timer);
      try {
        window.localStorage.setItem(key, pending.value);
      } catch {
        // intentional: storage may be full / disabled — drop this snapshot
      }
    }
    pendingByKey.clear();
  };

  // pagehide is the recommended hook for "tab is going away" on modern browsers
  // and Tauri webviews; beforeunload is a desktop fallback.
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("beforeunload", flushAll);
}

/**
 * A `Storage`-like object whose `setItem` calls are coalesced behind a
 * trailing debounce. Drop-in replacement for `localStorage` when used with
 * `createJSONStorage(() => createThrottledLocalStorage())` from zustand.
 *
 * Behaviour:
 * - `setItem(k, v)` schedules a write `debounceMs` later; subsequent writes
 *   to the same key reset the timer and overwrite the buffered value.
 * - `getItem(k)` returns the buffered value if a write is pending, else falls
 *   through to `localStorage.getItem`. Hydration after a tab restart still
 *   sees the last-flushed value.
 * - `removeItem(k)` cancels any pending write and removes the key
 *   synchronously.
 * - All pending writes flush synchronously on `pagehide`/`beforeunload`.
 */
export function createThrottledLocalStorage(
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): Storage {
  installFlushHook();

  const storage: Storage = {
    get length(): number {
      try {
        return window.localStorage.length;
      } catch {
        return 0;
      }
    },
    key(index: number): string | null {
      try {
        return window.localStorage.key(index);
      } catch {
        return null;
      }
    },
    getItem(name: string): string | null {
      const pending = pendingByKey.get(name);
      if (pending) return pending.value;
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem(name: string, value: string): void {
      const existing = pendingByKey.get(name);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        pendingByKey.delete(name);
        try {
          window.localStorage.setItem(name, value);
        } catch {
          // intentional: storage may be full / disabled
        }
      }, debounceMs);
      pendingByKey.set(name, { value, timer });
    },
    removeItem(name: string): void {
      const existing = pendingByKey.get(name);
      if (existing) {
        clearTimeout(existing.timer);
        pendingByKey.delete(name);
      }
      try {
        window.localStorage.removeItem(name);
      } catch {
        // intentional
      }
    },
    clear(): void {
      for (const pending of pendingByKey.values()) clearTimeout(pending.timer);
      pendingByKey.clear();
      try {
        window.localStorage.clear();
      } catch {
        // intentional
      }
    },
  };

  return storage;
}

/** Test/debug hook: synchronously drain pending writes to localStorage. */
export function flushThrottledStorage(): void {
  for (const [key, pending] of pendingByKey) {
    clearTimeout(pending.timer);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, pending.value);
      }
    } catch {
      // intentional
    }
  }
  pendingByKey.clear();
}
