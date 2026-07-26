import { lazy, createElement, type ComponentType } from 'react';

/**
 * True when an error is a failed dynamic-import (chunk fetch) rather than a
 * render bug. Covers the engine-specific messages: Chromium/WebView2
 * ("Failed to fetch dynamically imported module"), WebKit ("Importing a
 * module script failed"), Firefox ("error loading dynamically imported
 * module"). Error boundaries use this to offer a reload — resetting the
 * boundary alone can't fix a chunk that no longer exists on the server
 * (post-deploy hash change) or a dev server that went away.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

/**
 * Import with one automatic retry after 1.5 s — handles transient network
 * blips and stale-chunk 404s after a deploy.
 */
function importWithRetry<T>(importFn: () => Promise<T>): Promise<T> {
  return importFn().catch(
    () =>
      new Promise<T>((resolve, reject) =>
        setTimeout(() => importFn().then(resolve, reject), 1500),
      ),
  );
}

/**
 * Drop-in replacement for `React.lazy` with one automatic import retry, whose
 * *permanent* failures surface to the nearest ErrorBoundary instead of hanging.
 *
 * **Problem**: `React.lazy` calls its factory once and caches the resulting
 * promise. A transient blip (network hiccup, dev server mid-restart) that
 * happens to fail both `importWithRetry` attempts would otherwise cache the
 * rejection forever. And a chunk that can NEVER load — a dead dev server on
 * :1420, a stale post-deploy hash — leaves the Suspense boundary showing its
 * fallback with no recovery.
 *
 * **Fix**: keep ONE stable `React.lazy`. `importWithRetry` covers the transient
 * case; a permanent rejection is rethrown to the nearest ErrorBoundary, whose
 * chunk-error UI (`isChunkLoadError` → "Reload app", see `ErrorBoundary.tsx`)
 * is the reliable recovery — a full reload re-fetches the (now-available)
 * chunk. "Try Again" simply re-shows the error; it does not loop.
 *
 * **Why not swap to a fresh `React.lazy` on rejection?** An earlier version did
 * exactly that inside the failing promise's `.catch`, to retry without a full
 * reload. But the swap raced React's error propagation: React remounts the
 * suspended child when its promise settles, so it rendered the fresh *pending*
 * lazy and **re-suspended** instead of throwing the rejection to the boundary.
 * Against a permanently-unreachable chunk this looped forever — the user saw an
 * **infinite loading skeleton** and never the recoverable error UI. A single
 * stable instance is what guarantees the failure actually reaches the boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.FC<React.ComponentProps<T>> {
  const LazyImpl = lazy<T>(() => importWithRetry<{ default: T }>(importFn));

  // Thin, stable wrapper — Suspense still works: the inner lazy throws its
  // thenable and the nearest <Suspense> catches it; on a permanent rejection it
  // throws the (cached) error, which the nearest ErrorBoundary catches.
  function RetryableLazy(props: React.ComponentProps<T>) {
    return createElement(LazyImpl, props);
  }

  return RetryableLazy;
}
