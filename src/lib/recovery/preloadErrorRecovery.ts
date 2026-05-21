// Recovery for stale dynamic-import chunks. Vite emits `vite:preloadError`
// when a code-split chunk fails to fetch — common after `tauri-cli` restarts
// the Rust binary in dev (the WebView's HMR socket points at a dev server
// that has reloaded its module graph) and after production redeploys (asset
// URLs change between builds). A reload pulls a fresh `index.html` whose
// chunk paths are current and lets navigation continue.
//
// The throttle prevents infinite reload loops when the failure is genuine
// and reload doesn't fix it.

import { createLogger } from "@/lib/log";
import { silentCatch } from '@/lib/silentCatch';


export const RELOAD_KEY = "__vite_preload_reload_at";
export const DEFAULT_THROTTLE_MS = 30_000;

export type PreloadErrorRecoveryOptions = {
  /** Override the storage backend (defaults to `sessionStorage`). */
  storage?: Storage;
  /** Override the reload action (defaults to `window.location.reload()`). */
  reload?: () => void;
  /** Override the logger (defaults to a `preload-recovery` logger). */
  logger?: { error: (msg: string, ctx?: Record<string, unknown>) => void };
  /** Override the now() function for deterministic tests. */
  now?: () => number;
  /** Throttle window in ms; default 30 000 ms. */
  throttleMs?: number;
  /** EventTarget to bind the listener to (defaults to `window`). */
  target?: EventTarget;
};

/**
 * Install the `vite:preloadError` listener that reloads the page on a stale
 * chunk failure. Returns the listener so callers can detach it (used in tests).
 */
export function installPreloadErrorRecovery(
  options: PreloadErrorRecoveryOptions = {},
): (event: Event) => void {
  const target = options.target ?? window;
  const storage = options.storage ?? sessionStorage;
  const reload = options.reload ?? (() => window.location.reload());
  const logger = options.logger ?? createLogger("preload-recovery");
  const now = options.now ?? Date.now;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;

  const handler = (event: Event) => {
    const lastReloadAt = Number(storage.getItem(RELOAD_KEY) || "0");
    const t = now();
    const evt = event as Event & { message?: string; payload?: unknown };
    if (t - lastReloadAt < throttleMs) {
      logger.error(
        "vite:preloadError repeated within throttle — letting it surface",
        { message: evt.message },
      );
      return;
    }
    storage.setItem(RELOAD_KEY, String(t));
    try {
      evt.preventDefault?.();
    } catch (err) { silentCatch("lib/recovery/preloadErrorRecovery:catch1")(err); }
    logger.error("vite:preloadError — reloading to pick up fresh chunks", {
      message: evt.message,
    });
    reload();
  };

  target.addEventListener("vite:preloadError", handler);
  return handler;
}
